// 文件名称: commands.rs
// 功能描述: 定义暴露给 Tauri 前端 Webview 调用的 IPC 命令接口。

use crate::AppState;
use serde_json::{json, Value};
use tauri::State;

/// 执行 Sidecar 健康自检命令
#[tauri::command]
pub async fn check_sidecar_health(state: State<'_, AppState>) -> Result<bool, String> {
    state.sidecar.ping().await.map_err(|e| e.to_string())
}

/// 查询当前所有已激活的插件元数据列表
#[tauri::command]
pub async fn get_active_plugins(state: State<'_, AppState>) -> Result<Value, String> {
    state.sidecar.list_plugins().await.map_err(|e| e.to_string())
}

/// 查询当前微内核所有已注册的工具能力列表
#[tauri::command]
pub async fn get_registered_tools(state: State<'_, AppState>) -> Result<Value, String> {
    state.sidecar.list_tools().await.map_err(|e| e.to_string())
}

/// 创建一个新的 Agent 会话
#[tauri::command]
pub async fn create_session(
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("session.create", Some(json!({ "title": title })))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 获取所有历史会话列表
#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("session.list", None)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 获取指定会话的消息历史
#[tauri::command]
pub async fn get_session_messages(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("session.getMessages", Some(json!({ "sessionId": session_id })))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 发送消息启动 Agent 执行流
#[tauri::command]
pub async fn send_session_message(
    session_id: String,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request(
            "session.sendMessage",
            Some(json!({ "sessionId": session_id, "prompt": prompt })),
        )
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 中断指定会话正在运行的任务
#[tauri::command]
pub async fn interrupt_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("session.interrupt", Some(json!({ "sessionId": session_id })))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 查询当前会话或全局的代码差异记录
#[tauri::command]
pub async fn list_diffs(
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("diff.list", Some(json!({ "sessionId": session_id })))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 审查并应用/放弃指定代码差异
#[tauri::command]
pub async fn apply_diff(
    diff_id: String,
    accepted: boolean_param::AcceptState,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request(
            "diff.apply",
            Some(json!({ "diffId": diff_id, "accepted": accepted.0 })),
        )
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 查询当前所有挂起待审批的敏感操作请求
#[tauri::command]
pub async fn list_pending_approvals(state: State<'_, AppState>) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request("approval.list", None)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 对指定敏感操作请求进行审批反馈 (同意/拒绝)
#[tauri::command]
pub async fn respond_approval(
    request_id: String,
    approved: boolean_param::AcceptState,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request(
            "approval.respond",
            Some(json!({ "requestId": request_id, "approved": approved.0 })),
        )
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

/// 触发企业远程配置与推荐插件同步
#[tauri::command]
pub async fn sync_enterprise_config(
    remote_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let res = state
        .sidecar
        .send_request(
            "config.sync",
            Some(json!({ "remoteUrl": remote_url })),
        )
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = res.error {
        return Err(err.message);
    }
    Ok(res.result.unwrap_or(Value::Null))
}

mod boolean_param {
    use serde::{Deserialize, Deserializer};

    #[derive(Debug, Clone, Copy)]
    pub struct AcceptState(pub bool);

    impl<'de> Deserialize<'de> for AcceptState {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: Deserializer<'de>,
        {
            let b = bool::deserialize(deserializer)?;
            Ok(AcceptState(b))
        }
    }
}
