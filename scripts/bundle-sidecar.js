/**
 * @fileoverview Tauri Sidecar 与 Node 运行时捆绑脚本
 * @description 将编译后的 Sidecar（dist + 全量 node_modules，含 dsh 引擎依赖与原生二进制）压缩为
 * 单个 `sidecar.tar.gz` 归档，并将独立 Node 运行时（≥22.19）复制到 src-tauri/resources/，
 * 供 Tauri 产出免装 Node 的独立安装包。Rust 宿主首启将归档解压到可写的 App Data 目录。
 *
 * 采用"单归档"而非"裸目录"的原因：sidecar 含 3.2 万+ 文件（node_modules），Tauri 资源打包
 * 对海量文件不可靠（实测 NSIS 安装后 sidecar 为空），单文件归档打包与安装都稳定。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const sidecarDir = path.join(rootDir, "sidecar");
const sidecarDist = path.join(sidecarDir, "dist");
const sidecarModules = path.join(sidecarDir, "node_modules");
const resourceDir = path.join(rootDir, "src-tauri", "resources");
const stagingSidecarDir = path.join(resourceDir, "sidecar");
const targetArchive = path.join(resourceDir, "sidecar.tar.gz");
const targetNodeDir = path.join(resourceDir, "node");

/** 递归计算目录总字节数 */
function dirSize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isSymbolicLink()) total += fs.statSync(full, { throwIfNoEntry: false })?.size ?? 0;
    else total += fs.statSync(full).size;
  }
  return total;
}

console.log("[bundle] 1. 编译 Sidecar TypeScript...");
execSync("npm run build", { cwd: sidecarDir, stdio: "inherit" });

console.log("[bundle] 2. 清理并重建 resources 目录...");
for (const dir of [resourceDir]) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
fs.mkdirSync(stagingSidecarDir, { recursive: true });
fs.mkdirSync(targetNodeDir, { recursive: true });

console.log("[bundle] 3. 组装 sidecar 暂存目录（dist + node_modules + package.json）...");
fs.cpSync(sidecarDist, path.join(stagingSidecarDir, "dist"), { recursive: true });
fs.cpSync(sidecarModules, path.join(stagingSidecarDir, "node_modules"), { recursive: true });
fs.copyFileSync(path.join(sidecarDir, "package.json"), path.join(stagingSidecarDir, "package.json"));

console.log("[bundle] 4. 压缩 sidecar 为单归档 sidecar.tar.gz（排除非运行时文件，文件数约减半）...");
// 排除 .d.ts/.map/README/LICENSE/CHANGELOG/test 等运行时不需要的文件，缩短首启解压时间。
execSync(
  `tar -czf sidecar.tar.gz -C sidecar ` +
    `--exclude='*/test/*' --exclude='*/tests/*' --exclude='*/__tests__/*' ` +
    `--exclude='*.test.js' --exclude='*.spec.js' --exclude='*.d.ts' --exclude='*.map' ` +
    `--exclude='README*' --exclude='LICENSE*' --exclude='CHANGELOG*' ` +
    `dist node_modules package.json`,
  { cwd: resourceDir, stdio: "inherit" }
);
const rawSidecarMb = (dirSize(stagingSidecarDir) / 1024 / 1024).toFixed(1);
const archiveMb = (fs.statSync(targetArchive).size / 1024 / 1024).toFixed(1);

// 只保留归档，删除裸目录（避免 Tauri 资源打包再碰海量文件）
console.log(`[bundle] 5. 删除裸 sidecar 目录（仅保留归档 ${archiveMb} MB）...`);
fs.rmSync(stagingSidecarDir, { recursive: true, force: true });

console.log("[bundle] 6. 复制独立 Node 运行时（可用 NODE_EXE_PATH 覆盖）...");
const nodeSrc = process.env.NODE_EXE_PATH || process.execPath;
fs.copyFileSync(nodeSrc, path.join(targetNodeDir, "node.exe"));
const nodeVersion = execSync(`"${nodeSrc}" --version`).toString().trim();
const ver = nodeVersion.match(/^v(\d+)\.(\d+)\./);
const ok = ver && ((Number(ver[1]) === 22 && Number(ver[2]) >= 19) || Number(ver[1]) >= 24);
if (!ok) {
  throw new Error(`捆绑的 Node 版本不满足 ^22.19 || >=24 要求: ${nodeVersion}`);
}

const nodeMb = (fs.statSync(path.join(targetNodeDir, "node.exe")).size / 1024 / 1024).toFixed(1);
console.log(
  `[bundle] 7. 捆绑完成: sidecar 归档 ${archiveMb} MB (raw ${rawSidecarMb} MB), node ${nodeVersion} ${nodeMb} MB`
);
console.log("[bundle] Ready for `cargo tauri build` packaging!");
