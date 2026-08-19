// 文件名称: diff_review_test.rs
// 功能描述: 代码差异提出、状态暂存与审查应用/放弃端到端集成测试。

use harness_desktop_lib::sidecar::SidecarManager;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

#[tokio::test]
async fn test_diff_propose_and_apply() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    let temp_workspace = std::env::temp_dir().join(format!("harness_diff_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_workspace).expect("Failed to create temp workspace");

    let target_file = temp_workspace.join("example.rs");
    fs::write(&target_file, "fn old_code() {}\n").expect("Failed to write initial file");

    let manager = SidecarManager::spawn("node", &script_path, &temp_workspace)
        .await
        .expect("Failed to spawn sidecar");

    // 1. 提出代码修改建议
    let propose_res = manager
        .send_request(
            "diff.propose",
            Some(json!({
                "sessionId": "sess_test",
                "filePath": target_file.to_str().unwrap(),
                "modifiedContent": "fn new_optimized_code() {\n    println!(\"Hello\");\n}\n"
            })),
        )
        .await
        .expect("diff.propose failed");

    let diff_id = propose_res.result.unwrap()["diff"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 2. 查询差异列表
    let list_res = manager
        .send_request("diff.list", Some(json!({ "sessionId": "sess_test" })))
        .await
        .expect("diff.list failed");

    let diffs = list_res.result.unwrap()["diffs"].as_array().unwrap().clone();
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0]["status"], "pending");
    assert_eq!(diffs[0]["language"], "rust");

    // 3. 接受并应用代码变更
    let apply_res = manager
        .send_request(
            "diff.apply",
            Some(json!({
                "diffId": diff_id,
                "accepted": true
            })),
        )
        .await
        .expect("diff.apply failed");

    assert_eq!(apply_res.result.unwrap()["record"]["status"], "accepted");

    // 4. 验证磁盘上的真实文件内容已更新
    let updated_content = fs::read_to_string(&target_file).expect("Failed to read updated file");
    assert!(updated_content.contains("new_optimized_code"));

    manager.shutdown().await.expect("Shutdown failed");
    let _ = fs::remove_dir_all(&temp_workspace);
}
