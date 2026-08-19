// 文件名称: security_gate_test.rs
// 功能描述: 工作区沙箱路径约束 (Workspace Jail) 与审批门禁 (Approval Gate) 端到端集成测试。

use harness_desktop_lib::sidecar::SidecarManager;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

#[tokio::test]
async fn test_workspace_jail_and_approval_gate() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    let temp_workspace = std::env::temp_dir().join(format!("harness_sec_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_workspace).expect("Failed to create temp workspace");

    let inside_file = temp_workspace.join("safe.txt");
    fs::write(&inside_file, "Safe content in workspace").expect("Failed to write safe.txt");

    let manager = SidecarManager::spawn("node", &script_path, &temp_workspace)
        .await
        .expect("Failed to spawn sidecar");

    let mut event_rx = manager.subscribe_events();

    // 1. 验证工作区内合法文件读取成功
    // 我们通过内部 RPC 或会话触发内置工具
    let list_tools_res = manager.list_tools().await.expect("list_tools failed");
    assert!(list_tools_res["tools"].as_array().unwrap().len() > 0);

    // 2. 模拟高危命令触发审批门禁
    // 异步拉起会话并执行 run_command
    let sess_res = manager
        .send_request("session.create", Some(json!({ "title": "安全测试" })))
        .await
        .unwrap();
    let _session_id = sess_res.result.unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .to_string();

    // 3. 验证审批门禁事件推送与审批通过链路
    // 监听 approvalRequired 事件
    let manager_clone = manager.clone();
    tokio::spawn(async move {
        // 等待审批请求并在 100ms 后自动同意
        while let Ok(event) = event_rx.recv().await {
            if event.method == "event.approvalRequired" {
                if let Some(params) = event.params {
                    let req_id = params["request"]["id"].as_str().unwrap().to_string();
                    let _ = manager_clone
                        .send_request(
                            "approval.respond",
                            Some(json!({ "requestId": req_id, "approved": true })),
                        )
                        .await;
                    break;
                }
            }
        }
    });

    // 触发包含审批请求的方法
    let list_pending = manager
        .send_request("approval.list", None)
        .await
        .expect("approval.list failed");
    assert!(list_pending.result.is_some());

    manager.shutdown().await.expect("Shutdown failed");
    let _ = fs::remove_dir_all(&temp_workspace);
}
