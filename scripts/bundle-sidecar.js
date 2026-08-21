/**
 * @fileoverview Tauri Sidecar 与 Node 运行时捆绑脚本
 * @description 将编译后的 Sidecar 生产闭包与 Node 22 LTS 直接部署到 Tauri resources，
 * 让安装器承担文件展开工作，应用首次启动可从只读安装目录原地运行，不再解压依赖。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const rootDir = process.cwd();
const sidecarDir = path.join(rootDir, "sidecar");
const resourceDir = path.join(rootDir, "src-tauri", "resources");
const stagingSidecarDir = path.join(resourceDir, "sidecar");
const targetManifest = path.join(resourceDir, "sidecar-manifest.json");
const targetNodeDir = path.join(resourceDir, "node");

const isWindows = process.platform === "win32";
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
execSync("npm run licenses:check", { cwd: rootDir, stdio: "inherit" });

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

const rawSidecarMb = (dirSize(stagingSidecarDir) / 1024 / 1024).toFixed(1);
console.log(`[bundle] 4. 保留可原地运行的 Sidecar 生产闭包 (${rawSidecarMb} MB)...`);

console.log("[bundle] 5. 复制 Node 22 LTS 运行时（可用 NODE_EXE_PATH 覆盖）...");
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
const ok = ver && (Number(ver[1]) === 22 ? Number(ver[2]) >= 19 : Number(ver[1]) > 22);
if (!ok) {
  throw new Error(`捆绑运行时必须是 Node 22.19+ LTS，当前为 ${nodeVersion}。请使用 .node-version 或设置 NODE_EXE_PATH。`);
}
const sidecarPackage = JSON.parse(fs.readFileSync(path.join(sidecarDir, "package.json"), "utf8"));
fs.writeFileSync(targetManifest, `${JSON.stringify({
  schema: 1,
  appVersion: sidecarPackage.version,
  dshVersion: sidecarPackage.dependencies["@deepseek-ai/dsh"],
  nodeVersion,
}, null, 2)}\n`);

const nodeMb = (fs.statSync(targetNodePath).size / 1024 / 1024).toFixed(1);
console.log(
  `[bundle] 6. 捆绑完成: sidecar ${rawSidecarMb} MB, node (${process.platform}) ${nodeVersion} ${nodeMb} MB`
);
console.log("[bundle] Ready for `cargo tauri build` packaging!");
