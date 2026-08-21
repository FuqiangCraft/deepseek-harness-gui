/**
 * @fileoverview 发布资源完整性与体积报告工具
 * @description 在安装包构建前验证 Sidecar、Node、许可证和更新清单，并输出可上传的 JSON 报告。
 */
import fs from "node:fs";
import path from "node:path";
import { findIncompatibleNativeBinaries } from "./native-bundle-filter.js";

const required = [
  "src-tauri/resources/sidecar/dist/boot.js",
  "src-tauri/resources/sidecar/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js",
  "src-tauri/resources/sidecar/package.json",
  "src-tauri/resources/sidecar-manifest.json",
  "THIRD_PARTY_LICENSES.txt",
];
const nodeBinary = process.platform === "win32" ? "src-tauri/resources/node/node.exe" : "src-tauri/resources/node/node";
required.push(nodeBinary);
for (const file of required) if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`missing release resource: ${file}`);
const manifest = JSON.parse(fs.readFileSync("src-tauri/resources/sidecar-manifest.json", "utf8"));
const nodeMajor = Number(manifest.nodeVersion?.match(/^v(\d+)\./)?.[1] || 0);
if (nodeMajor < 22 || !manifest.dshVersion) {
  throw new Error(`invalid sidecar manifest or non-LTS Node runtime: ${manifest.nodeVersion || "<missing>"}`);
}
const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (tauriConfig.bundle?.resources?.["resources/sidecar"] !== "sidecar") {
  throw new Error("Sidecar must use Tauri directory-walk resource mapping; glob mappings flatten node_modules paths");
}
const incompatibleNativeBinaries = findIncompatibleNativeBinaries(
  path.join("src-tauri", "resources", "sidecar", "node_modules")
);
if (incompatibleNativeBinaries.length > 0) {
  throw new Error(
    `bundle contains native binaries incompatible with the Linux glibc target: ${incompatibleNativeBinaries.join(", ")}`
  );
}
const report = Object.fromEntries(required.map((file) => [file, fs.statSync(file).size]));
fs.writeFileSync("bundle-size-report.json", `${JSON.stringify({ platform: process.platform, arch: process.arch, bytes: report, manifest }, null, 2)}\n`);
console.log(`[bundle] verified ${required.length} release resources`);
