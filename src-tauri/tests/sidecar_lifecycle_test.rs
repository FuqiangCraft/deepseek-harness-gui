// 文件名称: sidecar_lifecycle_test.rs
// 功能描述: Sidecar 进程生命周期与 Stdio JSON-RPC 通信端到端集成测试。

use harness_desktop_lib::sidecar::SidecarManager;
use std::path::PathBuf;

#[tokio::test]
async fn test_sidecar_spawn_ping_and_shutdown() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    assert!(
        script_path.exists(),
        "Sidecar dist/index.js must exist before running test"
    );

    // 拉起 Node.js Sidecar 子进程
    let manager = SidecarManager::spawn("node", &script_path, root_dir)
        .await
        .expect("Failed to spawn sidecar manager");

    // 订阅并捕获事件通知
    let mut event_rx = manager.subscribe_events();

    // 验证接收到 system.ready 通知或完成 ping
    let ping_success = manager.ping().await.expect("ping failed");
    assert!(ping_success, "system.ping should return true (status: pong)");

    // 验证事件流通道
    if let Ok(event) = event_rx.try_recv() {
        assert_eq!(event.method, "system.ready");
    }

    // 验证优雅终止
    manager
        .shutdown()
        .await
        .expect("shutdown should succeed");
}
