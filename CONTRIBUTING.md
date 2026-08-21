# 贡献指南 (Contributing Guide)

感谢你对 **DeepSeek Harness GUI** 的关注与支持！为了保证项目的代码质量、跨平台稳定性以及长久健康的社区协作，请在提交代码前仔细阅读本指南。

---

## 🛑 贡献守则与前置原则

1. **“先讨论，后动手”原则**：
   - 在提交超过 50 行代码的重构、新功能或引入新依赖之前，**必须先在 GitHub Issues 或 Discussions 中发起讨论**，获得维护者确认后再进行开发。
   - 未经事先讨论的大型 PR 或与项目路线图不符的 PR 将被直接关闭。
2. **拒绝无意义与 AI 灌水 PR**：
   - 严禁提交由 AI 大模型批量生成但未经本地编译、测试验证的 PR。
   - 严禁纯刷贡献的无意义改动（如在文档或代码中无端更改空格、重命名私有变量）。
3. **严格遵守法律与安全红线**：
   - **绝不得提交任何私有 API Key、Token、服务器密码或个人会话历史**。
   - **绝不得引入闭源、协议不兼容（如私有商业软件）的代码或资产**。
   - 安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下提交安全咨询，切勿公开发布 Issue。

---

## 🛠️ 本地开发环境要求

- **Node.js**: `^22.19.0` (推荐使用 LTS 22)
- **包管理器**: `npm >= 11.6.0`，`pnpm >= 11.9.0`
- **Rust**: `>= 1.80` (stable)
- **Tauri 2.0 平台依赖**：
  - Windows: Visual Studio C++ Build Tools & WebView2 Runtime
  - macOS: Xcode Command Line Tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`

### 本地初始化与编译

```bash
# 1. 安装前端宿主与 Sidecar 依赖
npm ci
cd sidecar && pnpm install --frozen-lockfile && cd ..

# 2. 构建前端与打包 Sidecar 引擎闭包
npm run build:all

# 3. 运行 Rust 单元测试与 Clippy 静态检查
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 4. 运行第三方依赖许可证合规检查
npm run licenses:check

# 5. 本地启动开发模式
npm run tauri dev
```

---

## 📝 提交信息规范 (Conventional Commits)

本项目建议遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，常用的 Commit 格式如下：

- `feat: 新增某项特性功能`
- `fix: 修复某个已知 Bug`
- `docs: 更新 README 或相关文档`
- `refactor: 代码重构（不改变功能与外部行为）`
- `perf: 性能优化`
- `test: 增加或修正自动化测试用例`
- `chore: 构建流程、依赖更新或 CI 配置变更`

---

## 🚀 提交流程

1. Fork 本仓库或创建特性分支进行开发。
2. 在本地完成编码与测试，**务必确保 `npm run build:all`、`cargo test` 与 `npm run licenses:check` 全部通过**。
3. 提交变更并说明所做的改动和测试验证情况。
