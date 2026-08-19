// 文件名称: plugin_loader_test.rs
// 功能描述: Cordis 微内核双层插件加载机制端到端集成测试，验证内置基线与动态插件目录挂载能力。

use harness_desktop_lib::sidecar::SidecarManager;
use std::fs;
use std::path::PathBuf;

#[tokio::test]
async fn test_builtin_and_dynamic_plugin_loading() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root_dir = manifest_dir.parent().unwrap();
    let script_path = root_dir.join("sidecar").join("dist").join("index.js");

    // 1. 创建临时工作区及插件目录
    let temp_workspace = std::env::temp_dir().join(format!("harness_test_{}", uuid::Uuid::new_v4()));
    let temp_plugin_dir = temp_workspace.join(".harness").join("plugins");
    fs::create_dir_all(&temp_plugin_dir).expect("Failed to create temp plugin dir");

    // 2. 写入自定义动态插件 JavaScript 文件
    let custom_plugin_code = r#"
export default function CustomEnterprisePlugin(ctx) {
  ctx.toolRegistry.registerTool({
    name: "enterprise_db_query",
    description: "企业内部安全数据库只读查询工具",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string" }
      },
      required: ["sql"]
    },
    execute: async ({ sql }) => {
      return { rows: [{ id: 1, name: "test_data" }] };
    }
  });
}
"#;
    let custom_plugin_path = temp_plugin_dir.join("enterprise-db.mjs");
    fs::write(&custom_plugin_path, custom_plugin_code).expect("Failed to write custom plugin");

    // 3. 在临时工作区下启动 Sidecar 运行时
    let manager = SidecarManager::spawn("node", &script_path, &temp_workspace)
        .await
        .expect("Failed to spawn sidecar in temp workspace");

    // 4. 查询已加载插件列表并断言
    let plugins_data = manager.list_plugins().await.expect("list_plugins failed");
    let plugins = plugins_data["plugins"].as_array().expect("plugins array");

    // 验证内置基线插件存在
    let builtin_plugin = plugins
        .iter()
        .find(|p| p["name"] == "deepseek-harness-base")
        .expect("Builtin plugin must exist");
    assert_eq!(builtin_plugin["source"], "builtin");

    // 验证动态外部插件被成功扫描并挂载
    let custom_plugin = plugins
        .iter()
        .find(|p| p["name"] == "enterprise-db")
        .expect("Custom dynamic plugin must be loaded");
    assert_eq!(custom_plugin["source"], "workspace");

    // 5. 查询全局工具列表，验证动态工具已被注册
    let tools_data = manager.list_tools().await.expect("list_tools failed");
    let tools = tools_data["tools"].as_array().expect("tools array");
    let custom_tool = tools
        .iter()
        .find(|t| t["name"] == "enterprise_db_query")
        .expect("Custom tool must be registered in tool registry");
    assert_eq!(custom_tool["description"], "企业内部安全数据库只读查询工具");

    // 6. 优雅销毁
    manager.shutdown().await.expect("Shutdown failed");

    // 清理临时目录
    let _ = fs::remove_dir_all(&temp_workspace);
}
