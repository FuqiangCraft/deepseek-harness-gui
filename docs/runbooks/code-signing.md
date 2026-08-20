<!--
文件说明: 桌面客户端代码签名与公证操作手册 (Code Signing Runbook)
功能描述: 记录为 Windows / macOS 发布包配置代码签名与 Notarization 的完整流程：证书申请、导出、GitHub Secrets 配置、CI 接线与签名后验证。
-->

# 代码签名与公证操作手册

未签名的安装包会触发 **Windows SmartScreen** 与 **macOS Gatekeeper** 拦截。稳定版工作流会强制检查全部签名、公证与 updater 密钥；任一凭据缺失即停止发布。Windows PFX 会临时导入 runner 的当前用户证书库并把 thumbprint 注入 Tauri 配置，任务结束后 runner 被销毁。

---

## 1. macOS：签名 + Notarization

### 1.1 前置条件
- 加入 **Apple Developer Program**（$99/年）。
- 安装 Xcode Command Line Tools（`xcode-select --install`）。

### 1.2 创建"Developer ID Application"证书
1. 打开 [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list) → 申请 **Developer ID Application** 证书。
2. 下载安装到钥匙串（Keychain）。

### 1.3 导出 .p12 并转 base64
```bash
security export -k ~/Library/Keychains/login.keychain-db \
  -t certs -f pkcs12 -o cert.p12 -P <导出密码>
openssl base64 -in cert.p12 -out cert.p12.b64
```
`cert.p12.b64` 的内容即 `APPLE_CERTIFICATE` secret；导出密码即 `APPLE_CERTIFICATE_PASSWORD`。

### 1.4 需要填写的 GitHub Secrets

| Secret | 值 |
|---|---|
| `APPLE_CERTIFICATE` | .p12 的 base64 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 导出密码 |
| `APPLE_SIGNING_IDENTITY` | 形如 `Developer ID Application: 你的名字 (TEAMID)` |
| `APPLE_ID` | Apple ID 邮箱（notarize 用） |
| `APPLE_PASSWORD` | Apple ID 的**应用专用密码**（非登录密码） |
| `APPLE_TEAM_ID` | 团队 ID（10 位） |

> App-specific password：`appleid.apple.com` → 登录与安全 → App 专用密码 → 生成。

### 1.5 发布后验证
```bash
# 校验签名（应显示 TeamIdentifier 且 Valid）
codesign -dv --verbose=4 "/path/to/DeepSeek Harness.app"

# 校验 Gatekeeper / 公证
spctl -a -t exec -vv "/path/to/DeepSeek Harness.app"

# 公证票据
xcrun stapler validate "/path/to/DeepSeek Harness.app"
```

### ⚠️ 关键提醒：内置 node 二进制必须被签名
macOS（尤其 Apple Silicon）要求**所有可执行文件**都有有效签名，否则无法启动。安装包内置的独立 Node 运行时位于：

```
<app>/Contents/Resources/node/node
```

若它未随 .app 一起签名，引擎将无法拉起。发布后必须验证：
```bash
codesign -dv --verbose=4 "<app>/Contents/Resources/node/node"
```
若提示 *code object is not signed at all*，则需要在 CI 中对 node 单独签名（可在 tauri-action 之前用 `security` + `codesign` 处理，或后续补一个专用 step）。

---

## 2. Windows：代码签名

### 2.1 证书来源
购买 **OV（组织验证）或 EV（扩展验证）** 代码签名证书（DigiCert / Sectigo 等）。EV 证书可即时获得 SmartScreen 信誉；OV 需累积信誉。

### 2.2 导出 .pfx 并转 base64
PowerShell：
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\cert.pfx'))
```
输出即 `WINDOWS_CERTIFICATE` secret；导出密码即 `WINDOWS_CERTIFICATE_PASSWORD`。

### 2.3 需要填写的 GitHub Secrets

| Secret | 值 |
|---|---|
| `WINDOWS_CERTIFICATE` | .pfx 的 base64 内容 |
| `WINDOWS_CERTIFICATE_PASSWORD` | .pfx 导出密码 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 独立私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥密码 |
| `TAURI_UPDATER_PUBLIC_KEY` | 与 updater 私钥配对的公钥 |

### 2.4 发布后验证
- 右键 `*-setup.exe` → 属性 → **数字签名** 选项卡 → 显示签名者与时间戳。
- 安装时不再出现"未知发布者"警告。

---

## 3. Secrets 配置方式

仓库 → Settings → **Secrets and variables → Actions** → New repository secret，逐条添加上表内容。

> ⚠️ 证书是敏感凭据，只通过 GitHub Secrets 注入，**严禁提交进仓库或写进任何源码/文档**。

---

## 4. 常见问题

- **tauri-action 报 "No certificate found"**：`APPLE_CERTIFICATE`/`WINDOWS_CERTIFICATE` 为空或 base64 不正确。
- **notarize 失败**：确认 `APPLE_ID`/`APPLE_PASSWORD`（应用专用密码）/`APPLE_TEAM_ID` 正确，且证书是 Developer ID 而非 Distribution。
- **macOS 上 node 启动失败（killed）**：见 §1.5 内置 node 签名校验。
- **签名后应用内部功能异常**：Hardened Runtime 会阻止未签名/注入，先复查 §1.5 全部验证项。
