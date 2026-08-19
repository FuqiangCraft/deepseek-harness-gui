// 文件名称: config_sync_test.rs
// 功能描述: 企业远程配置中心同步 (Config Sync) 端到端集成测试。

use harness_desktop_lib::sidecar::SidecarManager;
use serde_json::json;
use std::path::PathBuf;

#[tokio::test]
async fn test_enterprise_config_sync() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    let manager = SidecarManager::spawn("node", &script_path, root_dir)
        .await
        .expect("Failed to spawn sidecar");

    let sync_res = manager
        .send_request(
            "config.sync",
            Some(json!({ "remoteUrl": "https://config.test.corp/harness" })),
        )
        .await
        .expect("config.sync failed");

    let result = sync_res.result.unwrap();
    assert_eq!(result["success"], true);
    assert_eq!(result["pluginCount"], 2);

    manager.shutdown().await.expect("Shutdown failed");
}
