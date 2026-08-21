/**
 * @fileoverview 稳定发布时注入 Tauri updater 公钥
 * @description 从 GitHub Actions 环境读取非机密公钥，拒绝占位值进入正式安装包。
 */
import fs from "node:fs";
import path from "node:path";

const configPath = path.resolve("src-tauri", "tauri.conf.json");
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
if (!publicKey) throw new Error("TAURI_UPDATER_PUBLIC_KEY is required");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.plugins.updater.pubkey = publicKey;
if (process.platform === "win32") {
  const thumbprint = process.env.TAURI_WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
  if (thumbprint) {
    config.bundle.windows = {
      ...(config.bundle.windows || {}),
      certificateThumbprint: thumbprint,
      digestAlgorithm: "sha256",
      timestampUrl: "http://timestamp.digicert.com",
    };
  } else {
    console.log("[release] windows code-signing certificate not configured; building unsigned");
  }
}
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("[release] updater public key configured");
