// 文件名称: session_stream_test.rs
// 功能描述: Agent 会话生命周期、Token 流式推流与任务中断端到端集成测试。

use harness_desktop_lib::sidecar::SidecarManager;
use serde_json::json;
use std::path::PathBuf;

#[tokio::test]
async fn test_agent_session_stream_and_interrupt() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    let manager = SidecarManager::spawn("node", &script_path, root_dir)
        .await
        .expect("Failed to spawn sidecar");

    let mut event_rx = manager.subscribe_events();

    // 1. 创建会话
    let create_res = manager
        .send_request("session.create", Some(json!({ "title": "测试任务" })))
        .await
        .expect("session.create failed");
    let session_id = create_res.result.unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .to_string();

    // 2. 发送指令启动 Agent
    let send_res = manager
        .send_request(
            "session.sendMessage",
            Some(json!({ "sessionId": session_id, "prompt": "请列出当前项目目录下的文件" })),
        )
        .await
        .expect("session.sendMessage failed");
    assert_eq!(send_res.result.unwrap()["status"], "started");

    // 3. 收集流式事件
    let mut received_thought = false;
    let mut received_token = false;
    let mut received_tool = false;

    for _ in 0..20 {
        if let Ok(event) = tokio::time::timeout(std::time::Duration::from_millis(500), event_rx.recv()).await {
            if let Ok(notif) = event {
                if notif.method == "event.streamThought" {
                    received_thought = true;
                }
                if notif.method == "event.toolStart" || notif.method == "event.toolFinish" {
                    received_tool = true;
                }
                if notif.method == "event.streamToken" {
                    received_token = true;
                }
                if notif.method == "event.sessionCompleted" {
                    break;
                }
            }
        }
    }

    assert!(received_thought, "Should receive streamThought events");
    assert!(received_token, "Should receive streamToken events");
    assert!(received_tool, "Should receive tool execution events");

    // 4. 测试中断功能 (Interrupt)
    let _ = manager
        .send_request(
            "session.sendMessage",
            Some(json!({ "sessionId": session_id, "prompt": "耗时任务" })),
        )
        .await;

    let interrupt_res = manager
        .send_request(
            "session.interrupt",
            Some(json!({ "sessionId": session_id })),
        )
        .await
        .expect("session.interrupt failed");

    assert_eq!(interrupt_res.result.unwrap()["interrupted"], true);

    manager.shutdown().await.expect("Shutdown failed");
}
