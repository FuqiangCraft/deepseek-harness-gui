// 文件名称: manager.rs
// 功能描述: Sidecar 子进程生命周期管理器，负责拉起 Node.js 运行时、守护进程状态、路由 Stdio JSON-RPC 消息及优雅终止。

use crate::ipc::protocol::{RpcNotification, RpcRequest, RpcResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, Notify};
use tracing::{error, info, warn};

/// Sidecar 管理器错误类型
#[derive(Debug, Error)]
pub enum SidecarError {
    /// 进程拉起失败
    #[error("Failed to spawn sidecar process: {0}")]
    SpawnError(#[from] std::io::Error),

    /// 管道不可用
    #[error("Sidecar stdin/stdout pipe is not available")]
    PipeUnavailable,

    /// RPC 请求超时或通道关闭
    #[error("RPC request failed or timed out: {0}")]
    RpcError(String),

    /// 进程异常退出
    #[error("Sidecar process terminated unexpectedly")]
    ProcessTerminated,

    #[error("Sidecar did not report DSH_PORT within {0} seconds")]
    StartupTimeout(u64),
}

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<RpcResponse>>>>;

async fn wait_for_port_signal(
    port: &Mutex<Option<u16>>,
    port_notify: &Notify,
    port_closed: &AtomicBool,
    timeout: Duration,
) -> Result<u16, SidecarError> {
    let wait = async {
        loop {
            // 先订阅再检查，避免端口在两步之间就绪而丢失通知。
            let notified = port_notify.notified();
            if let Some(port) = *port.lock().await {
                return Ok(port);
            }
            if port_closed.load(Ordering::SeqCst) {
                return Err(SidecarError::ProcessTerminated);
            }
            notified.await;
        }
    };

    tokio::time::timeout(timeout, wait)
        .await
        .map_err(|_| SidecarError::StartupTimeout(timeout.as_secs()))?
}

/// Node.js Sidecar 运行时生命周期守护管理器
pub struct SidecarManager {
    stdin_tx: mpsc::Sender<String>,
    pending_requests: PendingRequests,
    event_tx: broadcast::Sender<RpcNotification>,
    request_counter: AtomicU64,
    child: Arc<Mutex<Option<Child>>>,
    script_path: PathBuf,
    /// DSH web 服务器实际绑定端口（由 sidecar stdout 的 `DSH_PORT=` 行上报）
    port: Arc<Mutex<Option<u16>>>,
    port_notify: Arc<Notify>,
    port_closed: Arc<AtomicBool>,
    /// Windows Job Object 守卫：宿主退出时 OS 自动终止 sidecar（防孤儿）。
    /// 只存不读：靠 Drop 关闭句柄触发 KILL_ON_JOB_CLOSE，故允许 dead_code。
    #[cfg(windows)]
    #[allow(dead_code)]
    job: Option<job_object::JobObjectGuard>,
}

impl SidecarManager {
    /// 拉起 Sidecar 子进程并启动后台 I/O 监听循环。
    ///
    /// # 参数
    /// * `node_binary` - Node.js 可执行文件路径（系统 node 或打包的独立二进制）
    /// * `script_path` - Sidecar 入口脚本路径（如 dist/boot.js）
    /// * `working_dir` - 工作区路径
    ///
    /// # 返回值
    /// 成功返回被 [`Arc`] 包裹的管理器实例，失败返回 [`SidecarError`]。
    pub async fn spawn(
        node_binary: impl AsRef<Path>,
        script_path: impl AsRef<Path>,
        working_dir: impl AsRef<Path>,
        run_id: &str,
    ) -> Result<Arc<Self>, SidecarError> {
        let run_id = run_id.to_string();
        let script_buf = script_path.as_ref().to_path_buf();
        info!(
            "Spawning sidecar: binary={:?}, script={:?}, cwd={:?}",
            node_binary.as_ref(),
            script_buf,
            working_dir.as_ref()
        );

        let mut cmd = Command::new(node_binary.as_ref());
        cmd.arg(&script_buf)
            .current_dir(working_dir.as_ref())
            .env("HARNESS_RUN_ID", &run_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // node 是控制台程序：默认 spawn 会弹出一个新的终端窗口。
        // CREATE_NO_WINDOW (0x08000000) 隐藏该窗口，避免打扰用户（tokio Command 原生支持）。
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        let mut child = cmd.spawn()?;

        // Windows Job Object（KILL_ON_JOB_CLOSE）：宿主进程退出（含被强杀）时，
        // OS 关闭 Job 最后一个句柄并自动终止其中所有子进程，根治孤儿 sidecar。
        #[cfg(windows)]
        let job = {
            let job = job_object::JobObjectGuard::create();
            match job {
                Ok(job) => {
                    if let Some(pid) = child.id() {
                        if let Err(e) = job.assign(pid) {
                            warn!("Failed to assign sidecar to job object: {e}");
                        }
                    }
                    Some(job)
                }
                Err(e) => {
                    warn!("Failed to create job object: {e}");
                    None
                }
            }
        };
        let stdin = child.stdin.take().ok_or(SidecarError::PipeUnavailable)?;
        let stdout = child.stdout.take().ok_or(SidecarError::PipeUnavailable)?;
        let stderr = child.stderr.take().ok_or(SidecarError::PipeUnavailable)?;

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(128);
        let (event_tx, _) = broadcast::channel::<RpcNotification>(256);
        let pending_requests: PendingRequests = Arc::new(Mutex::new(HashMap::new()));
        let port: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));
        let port_notify = Arc::new(Notify::new());
        let port_closed = Arc::new(AtomicBool::new(false));

        // 后台任务 1: 写入子进程 stdin
        tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(msg) = stdin_rx.recv().await {
                if let Err(e) = writer.write_all(msg.as_bytes()).await {
                    error!("Failed to write to sidecar stdin: {}", e);
                    break;
                }
                if let Err(e) = writer.write_all(b"\n").await {
                    error!("Failed to write newline to sidecar stdin: {}", e);
                    break;
                }
                if let Err(e) = writer.flush().await {
                    error!("Failed to flush sidecar stdin: {}", e);
                    break;
                }
            }
        });

        // 后台任务 2: 读取子进程 stdout 并路由分发
        let pending_clone = pending_requests.clone();
        let event_tx_clone = event_tx.clone();
        let port_clone = port.clone();
        let port_notify_clone = port_notify.clone();
        let port_closed_clone = port_closed.clone();
        let stdout_run_id = run_id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // 识别 sidecar 上报的 DSH web 端口行 (DSH_PORT=<port>)
                if let Some(rest) = trimmed.strip_prefix("DSH_PORT=") {
                    if let Ok(port_value) = rest.trim().parse::<u16>() {
                        let mut port_guard = port_clone.lock().await;
                        *port_guard = Some(port_value);
                        port_notify_clone.notify_waiters();
                    }
                    continue;
                }

                // 尝试解析为 RPC 响应 (包含 id)
                if let Ok(res) = serde_json::from_str::<RpcResponse>(trimmed) {
                    let mut lock = pending_clone.lock().await;
                    if let Some(sender) = lock.remove(&res.id) {
                        let _ = sender.send(res);
                    }
                    continue;
                }

                // 尝试解析为单向事件通知 (无 id)
                if let Ok(notif) = serde_json::from_str::<RpcNotification>(trimmed) {
                    let _ = event_tx_clone.send(notif);
                    continue;
                }

                info!(target: "sidecar_stdout", run_id = %stdout_run_id, component = "sidecar", "{}", trimmed);
            }
            port_closed_clone.store(true, Ordering::SeqCst);
            port_notify_clone.notify_waiters();
            info!(run_id = %stdout_run_id, component = "sidecar", "Sidecar stdout reader terminated");
        });

        // AppImage 通常由桌面双击启动，没有可见终端；将 Node 的启动错误写入宿主日志。
        let stderr_run_id = run_id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                match serde_json::from_str::<Value>(&line) {
                    Ok(record) if record.get("level").and_then(Value::as_str) == Some("error") => {
                        error!(target: "sidecar_stderr", run_id = %stderr_run_id, component = "sidecar", "{}", line);
                    }
                    _ => {
                        info!(target: "sidecar_stderr", run_id = %stderr_run_id, component = "sidecar", "{}", line)
                    }
                }
            }
            info!(target: "sidecar_stderr", run_id = %stderr_run_id, component = "sidecar", "Sidecar stderr reader terminated");
        });

        let manager = Arc::new(Self {
            stdin_tx,
            pending_requests,
            event_tx,
            request_counter: AtomicU64::new(1),
            child: Arc::new(Mutex::new(Some(child))),
            script_path: script_buf,
            port,
            port_notify,
            port_closed,
            #[cfg(windows)]
            job,
        });

        let monitored_child = manager.child.clone();
        let monitored_closed = manager.port_closed.clone();
        let monitored_notify = manager.port_notify.clone();
        let monitor_run_id = run_id;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let status = {
                    let mut guard = monitored_child.lock().await;
                    match guard.as_mut() {
                        Some(child) => child.try_wait(),
                        None => return,
                    }
                };
                match status {
                    Ok(Some(status)) => {
                        monitored_closed.store(true, Ordering::SeqCst);
                        monitored_notify.notify_waiters();
                        error!(target: "sidecar_lifecycle", run_id = %monitor_run_id, component = "sidecar", exit_code = status.code(), "sidecar_process_exited");
                        return;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        warn!(target: "sidecar_lifecycle", run_id = %monitor_run_id, component = "sidecar", "failed_to_query_sidecar_status: {error}");
                        return;
                    }
                }
            }
        });

        Ok(manager)
    }

    /// 向 Sidecar 发送强类型的 JSON-RPC 请求并异步等待其返回响应。
    ///
    /// # 参数
    /// * `method` - 调用的远程方法名称
    /// * `params` - 方法参数
    pub async fn send_request(
        &self,
        method: impl Into<String>,
        params: Option<Value>,
    ) -> Result<RpcResponse, SidecarError> {
        let req_id = self
            .request_counter
            .fetch_add(1, Ordering::SeqCst)
            .to_string();
        let request = RpcRequest::new(&req_id, method, params);

        let (resp_tx, resp_rx) = oneshot::channel();
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(req_id.clone(), resp_tx);
        }

        let serialized =
            serde_json::to_string(&request).map_err(|e| SidecarError::RpcError(e.to_string()))?;

        self.stdin_tx
            .send(serialized)
            .await
            .map_err(|_| SidecarError::PipeUnavailable)?;

        // 默认 10 秒超时等待响应
        match tokio::time::timeout(std::time::Duration::from_secs(10), resp_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => {
                let mut pending = self.pending_requests.lock().await;
                pending.remove(&req_id);
                Err(SidecarError::RpcError(
                    "Response channel closed".to_string(),
                ))
            }
            Err(_) => {
                let mut pending = self.pending_requests.lock().await;
                pending.remove(&req_id);
                Err(SidecarError::RpcError("Request timed out".to_string()))
            }
        }
    }

    /// 发起系统心跳检测 (system.ping)，验证 Sidecar 是否健康存活。
    pub async fn ping(&self) -> Result<bool, SidecarError> {
        let res = self.send_request("system.ping", None).await?;
        if let Some(result) = res.result {
            if let Some(status) = result.get("status").and_then(|v| v.as_str()) {
                return Ok(status == "pong");
            }
        }
        Ok(false)
    }

    /// 查询当前已加载的插件元数据列表
    pub async fn list_plugins(&self) -> Result<Value, SidecarError> {
        let res = self.send_request("plugins.list", None).await?;
        if let Some(error) = res.error {
            return Err(SidecarError::RpcError(error.message));
        }
        Ok(res
            .result
            .unwrap_or_else(|| serde_json::json!({"plugins": []})))
    }

    /// 查询当前所有已注册的工具列表
    pub async fn list_tools(&self) -> Result<Value, SidecarError> {
        let res = self.send_request("tools.list", None).await?;
        if let Some(error) = res.error {
            return Err(SidecarError::RpcError(error.message));
        }
        Ok(res
            .result
            .unwrap_or_else(|| serde_json::json!({"tools": []})))
    }

    /// 订阅 Sidecar 发送给宿主的单向事件流。
    pub fn subscribe_events(&self) -> broadcast::Receiver<RpcNotification> {
        self.event_tx.subscribe()
    }

    /// 获取当前加载的 Sidecar 脚本路径
    pub fn script_path(&self) -> &Path {
        &self.script_path
    }

    /// 等待 Sidecar 上报 DSH web 服务器端口（`DSH_PORT=` 行）。
    ///
    /// # 返回
    /// 侧边进程就绪后返回实际绑定的 loopback 端口；进程退出或等待超时时返回错误。
    pub async fn wait_for_port(&self, timeout: Duration) -> Result<u16, SidecarError> {
        wait_for_port_signal(&self.port, &self.port_notify, &self.port_closed, timeout).await
    }

    /// 优雅终止并清理 Sidecar 子进程。
    ///
    /// 新版 Sidecar 无 RPC server（官方 DSH Host 直连），直接终止进程；
    /// 引擎状态由 $DSH_HOME 会话持久化负责，无需停机握手。
    pub async fn shutdown(&self) -> Result<(), SidecarError> {
        info!("Shutting down sidecar process...");
        let mut lock = self.child.lock().await;
        if let Some(mut child) = lock.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            info!("Sidecar process successfully killed and cleaned up");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn waiting_for_port_times_out_instead_of_hanging_forever() {
        let port = Mutex::new(None);
        let notify = Notify::new();
        let closed = AtomicBool::new(false);

        let result = wait_for_port_signal(&port, &notify, &closed, Duration::from_millis(10)).await;

        assert!(matches!(result, Err(SidecarError::StartupTimeout(_))));
    }

    #[tokio::test]
    async fn waiting_for_port_returns_reported_port() {
        let port = Mutex::new(Some(43123));
        let notify = Notify::new();
        let closed = AtomicBool::new(false);

        let result = wait_for_port_signal(&port, &notify, &closed, Duration::from_secs(5)).await;

        assert_eq!(result.expect("reported port"), 43123);
    }

    #[tokio::test]
    async fn waiting_for_port_reports_terminated_sidecar() {
        let port = Mutex::new(None);
        let notify = Notify::new();
        let closed = AtomicBool::new(true);

        let result = wait_for_port_signal(&port, &notify, &closed, Duration::from_secs(5)).await;

        assert!(matches!(result, Err(SidecarError::ProcessTerminated)));
    }
}

/// Windows Job Object 孤儿进程防护（仅 Windows 编译）。
///
/// 宿主进程退出（正常关闭、崩溃或被任务管理器强杀）时，OS 关闭该进程持有的
/// Job 最后一个句柄，`KILL_ON_JOB_CLOSE` 令 OS 自动终止 Job 内所有子进程，
/// 从而根治 Sidecar 变成孤儿进程的问题。句柄随 SidecarManager 生命周期持有。
#[cfg(windows)]
mod job_object {
    use std::mem::size_of;
    use std::os::raw::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Job Object 句柄守卫：Drop 时关闭句柄；若这是最后一个句柄，
    /// 且设置了 KILL_ON_JOB_CLOSE，OS 会终止 Job 内全部进程。
    pub struct JobObjectGuard(HANDLE);

    impl JobObjectGuard {
        /// 创建带 `KILL_ON_JOB_CLOSE` 的 Job Object。
        pub fn create() -> std::io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return Err(std::io::Error::last_os_error());
                }
                Ok(Self(handle))
            }
        }

        /// 将指定 PID 的进程加入该 Job。
        pub fn assign(&self, pid: u32) -> std::io::Result<()> {
            unsafe {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let ok = AssignProcessToJobObject(self.0, process);
                CloseHandle(process);
                if ok == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            }
        }
    }

    impl Drop for JobObjectGuard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    // Windows 内核对象句柄可在任意线程使用，句柄唯一由 SidecarManager 持有并在 Drop 时关闭，
    // 因此 Send/Sync 是安全的（不存在并发关闭）。
    unsafe impl Send for JobObjectGuard {}
    unsafe impl Sync for JobObjectGuard {}
}
