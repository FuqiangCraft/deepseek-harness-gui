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
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const rootDir = process.cwd();
const sidecarDir = path.join(rootDir, "sidecar");
const resourceDir = path.join(rootDir, "src-tauri", "resources");
const stagingSidecarDir = path.join(resourceDir, "sidecar");
const targetArchive = path.join(resourceDir, "sidecar.tar.gz");
const targetNodeDir = path.join(resourceDir, "node");

const isWindows = process.platform === "win32";
// Windows 上 Git for Windows 会把 GNU tar 放进 PATH 且优先于系统自带 bsdtar，
// GNU tar 无法正确处理本脚本的归档参数（报 "Cannot connect to D:"），
// 因此显式使用 Windows 自带的 bsdtar（System32\tar.exe），与 CI 环境行为一致。
const tarBin = isWindows ? "C:\\Windows\\System32\\tar.exe" : "tar";

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

console.log("[bundle] 3. 生成可独立部署的 Sidecar 生产依赖目录...");
// 不直接复制 pnpm 的 node_modules：Linux 上其中可能包含链接到虚拟 store 的符号链接，
// 归档或首次解压后会变成悬空链接，最终导致 ERR_MODULE_NOT_FOUND。
// 在工作区外安装生产依赖，避免把本机 pnpm 虚拟 store 的链接带进发布包。
const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sidecar-deploy-"));
const deployDir = path.join(deployRoot, "app");
fs.mkdirSync(deployDir, { recursive: true });
fs.copyFileSync(path.join(sidecarDir, "package.json"), path.join(deployDir, "package.json"));
fs.copyFileSync(path.join(sidecarDir, "pnpm-lock.yaml"), path.join(deployDir, "pnpm-lock.yaml"));
fs.copyFileSync(path.join(sidecarDir, "pnpm-workspace.yaml"), path.join(deployDir, "pnpm-workspace.yaml"));
fs.cpSync(path.join(sidecarDir, "patches"), path.join(deployDir, "patches"), { recursive: true });
execSync("pnpm install --prod --frozen-lockfile --node-linker=hoisted", {
  cwd: deployDir,
  stdio: "inherit",
});
fs.cpSync(path.join(sidecarDir, "dist"), path.join(stagingSidecarDir, "dist"), { recursive: true });
fs.cpSync(path.join(deployDir, "node_modules"), path.join(stagingSidecarDir, "node_modules"), {
  recursive: true,
});
fs.copyFileSync(path.join(deployDir, "package.json"), path.join(stagingSidecarDir, "package.json"));
fs.rmSync(deployRoot, { recursive: true, force: true });

// 发布前反馈环：从部署目录本身解析关键启动依赖。漏包时在 CI 打包阶段直接失败，
// 而不是等用户安装 AppImage 后卡在启动页。
const resolveProbe = `
  const { createRequire } = require("node:module");
  const { join } = require("node:path");
  const root = process.argv[1];
  const requireFromDeploy = createRequire(join(root, "package.json"));
  process.stdout.write(requireFromDeploy.resolve("@deepseek-ai/dsh-app-boot"));
`;
function resolveBootPackage(root) {
  return execFileSync(process.execPath, ["-e", resolveProbe, root], { encoding: "utf8" }).trim();
}
const resolvedBootPackage = resolveBootPackage(stagingSidecarDir);
console.log(`[bundle] 已验证关键启动依赖: ${resolvedBootPackage}`);

console.log("[bundle] 4. 压缩 sidecar 为单归档 sidecar.tar.gz（排除非运行时文件，文件数约减半）...");
// 排除 .d.ts/.map/README/LICENSE/CHANGELOG/test 等运行时不需要的文件，缩短首启解压时间。
// 用 execFileSync 直接传参：不经 shell，避免 GNU tar 的 `D:` 远程解析与引号转义问题。
execFileSync(
  tarBin,
  [
    "-czf", "sidecar.tar.gz", "-C", "sidecar",
    "--exclude=*/test/*", "--exclude=*/tests/*", "--exclude=*/__tests__/*",
    "--exclude=*.test.js", "--exclude=*.spec.js", "--exclude=*.d.ts", "--exclude=*.map",
    "--exclude=README*", "--exclude=LICENSE*", "--exclude=CHANGELOG*",
    "dist", "node_modules", "package.json",
  ],
  { cwd: resourceDir, stdio: "inherit" }
);

// 验证最终归档，而不只验证归档前的暂存目录。
const archiveCheckDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sidecar-archive-check-"));
execFileSync(tarBin, ["-xzf", targetArchive, "-C", archiveCheckDir], { stdio: "inherit" });
const archivedBootPackage = resolveBootPackage(archiveCheckDir);
console.log(`[bundle] 已验证最终归档依赖: ${archivedBootPackage}`);
fs.rmSync(archiveCheckDir, { recursive: true, force: true });
const rawSidecarMb = (dirSize(stagingSidecarDir) / 1024 / 1024).toFixed(1);
const archiveMb = (fs.statSync(targetArchive).size / 1024 / 1024).toFixed(1);

// 只保留归档，删除裸目录（避免 Tauri 资源打包再碰海量文件）
console.log(`[bundle] 5. 删除裸 sidecar 目录（仅保留归档 ${archiveMb} MB）...`);
fs.rmSync(stagingSidecarDir, { recursive: true, force: true });

console.log("[bundle] 6. 复制独立 Node 运行时（可用 NODE_EXE_PATH 覆盖）...");
const nodeBinaryName = isWindows ? "node.exe" : "node";
const targetNodePath = path.join(targetNodeDir, nodeBinaryName);
const nodeSrc = process.env.NODE_EXE_PATH || process.execPath;
fs.copyFileSync(nodeSrc, targetNodePath);
if (!isWindows) {
  try {
    fs.chmodSync(targetNodePath, 0o755);
  } catch (e) {
    console.warn(`[bundle] chmod 0755 failed: ${e.message}`);
  }
}
const nodeVersion = execSync(`"${targetNodePath}" --version`).toString().trim();
const ver = nodeVersion.match(/^v(\d+)\.(\d+)\./);
const ok = ver && ((Number(ver[1]) === 22 && Number(ver[2]) >= 19) || Number(ver[1]) >= 24);
if (!ok) {
  throw new Error(`捆绑的 Node 版本不满足 ^22.19 || >=24 要求: ${nodeVersion}`);
}

const nodeMb = (fs.statSync(targetNodePath).size / 1024 / 1024).toFixed(1);
console.log(
  `[bundle] 7. 捆绑完成: sidecar 归档 ${archiveMb} MB (raw ${rawSidecarMb} MB), node (${process.platform}) ${nodeVersion} ${nodeMb} MB`
);
console.log("[bundle] Ready for `cargo tauri build` packaging!");
