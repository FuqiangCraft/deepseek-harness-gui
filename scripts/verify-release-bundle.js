/**
 * @fileoverview 发布资源完整性与体积报告工具
 * @description 在安装包构建前验证 Sidecar、Node、许可证和更新清单，并输出可上传的 JSON 报告。
 */
import fs from "node:fs";
import path from "node:path";

const required = ["src-tauri/resources/sidecar.tar.gz", "src-tauri/resources/sidecar-manifest.json", "THIRD_PARTY_LICENSES.txt"];
const nodeBinary = process.platform === "win32" ? "src-tauri/resources/node/node.exe" : "src-tauri/resources/node/node";
required.push(nodeBinary);
for (const file of required) if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`missing release resource: ${file}`);
const manifest = JSON.parse(fs.readFileSync("src-tauri/resources/sidecar-manifest.json", "utf8"));
if (!/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) throw new Error("invalid sidecar archive SHA-256 manifest");
const report = Object.fromEntries(required.map((file) => [file, fs.statSync(file).size]));
fs.writeFileSync("bundle-size-report.json", `${JSON.stringify({ platform: process.platform, arch: process.arch, bytes: report, manifest }, null, 2)}\n`);
console.log(`[bundle] verified ${required.length} release resources`);
