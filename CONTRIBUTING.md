# Contributing

感谢参与 DeepSeek Harness Desktop。提交变更前请先搜索现有 Issue；较大功能请先创建讨论或 Issue，说明用户行为、平台影响和测试计划。

## Development

要求 Node.js 22.19、npm 11、pnpm 11、Rust 1.89，以及 Tauri 对应平台依赖。

```bash
npm ci
cd sidecar && pnpm install --frozen-lockfile && cd ..
npm run build:all
cargo test --manifest-path src-tauri/Cargo.toml
```

所有新文件需遵循 `AGENT.md` 的中文文件头和文档注释规范。提交不得包含密钥、用户日志、模型会话或工作区内容。Bug 修复应包含回归测试；跨平台改动需说明已验证的平台。

## Pull Requests

保持提交小而可审查，更新 CHANGELOG，并确认构建、测试、许可证检查全部通过。安全问题请按 SECURITY.md 私下报告。
