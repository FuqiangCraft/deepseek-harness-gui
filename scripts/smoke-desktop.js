/**
 * @fileoverview 已构建桌面程序的首次与二次启动性能冒烟测试
 * @description 在隔离用户目录中启动程序，等待 navigation_complete 结构化日志，检查启动耗时并确保进程可终止。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const executable = process.env.HARNESS_SMOKE_EXECUTABLE;
if (!executable || !fs.existsSync(executable)) throw new Error(`HARNESS_SMOKE_EXECUTABLE not found: ${executable || "<empty>"}`);
const requestedRoot = process.env.HARNESS_SMOKE_USER_ROOT;

/** 创建互相隔离的冷启动用户目录。 */
function createColdRoot(index) {
  if (!requestedRoot) return fs.mkdtempSync(path.join(os.tmpdir(), `harness smoke 中文-${index}-`));
  const root = path.join(requestedRoot, `cold-${index}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** 递归查找 JSONL 日志中一次完成导航的记录。 */
function findNavigation(root) {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/harness\.log/i.test(entry.name)) {
        const lines = fs.readFileSync(full, "utf8").split(/\r?\n/).reverse();
        for (const line of lines) {
          if (!line.includes("navigation_complete")) continue;
          try {
            const record = JSON.parse(line);
            return Number(record.duration_ms ?? record.fields?.duration_ms ?? 0);
          } catch { /* Ignore partial lines while the logger is flushing. */ }
        }
      }
    }
  }
  return null;
}

/** 删除上一轮日志但保留 App Data，以区分首启与二次启动。 */
function clearHarnessLogs(root) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/harness\.log/i.test(entry.name)) { try { fs.rmSync(full); } catch { /* Best effort. */ } }
    }
  }
}

/** 保存每轮日志快照，便于性能门禁失败后定位最慢阶段。 */
function snapshotHarnessLogs(root, index) {
  const destination = path.join(root, "smoke-logs");
  fs.mkdirSync(destination, { recursive: true });
  const logRoot = path.join(root, "logs");
  const stack = fs.existsSync(logRoot) ? [logRoot] : [];
  for (let cursor = 0; cursor < stack.length; cursor += 1) {
    const current = stack[cursor];
    if (current === destination) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/harness\.log/i.test(entry.name)) fs.copyFileSync(full, path.join(destination, `launch-${index}.jsonl`));
    }
  }
}

/** 执行一次启动并返回日志记录的总耗时。 */
async function launchOnce(index, userRoot) {
  const dshHome = path.join(userRoot, ".dsh");
  fs.mkdirSync(dshHome, { recursive: true });
  clearHarnessLogs(path.join(userRoot, "logs"));
  const env = { ...process.env, RUST_LOG: process.env.RUST_LOG || "info", DSH_HOME: dshHome, HARNESS_LOG_DIR: path.join(userRoot, "logs"), HARNESS_APP_DATA_DIR: path.join(userRoot, "app-data"), HOME: userRoot, USERPROFILE: userRoot, APPDATA: path.join(userRoot, "AppData", "Roaming"), LOCALAPPDATA: path.join(userRoot, "AppData", "Local"), XDG_CONFIG_HOME: path.join(userRoot, ".config"), XDG_DATA_HOME: path.join(userRoot, ".local", "share") };
  const command = process.env.HARNESS_SMOKE_WRAPPER || executable;
  const args = process.env.HARNESS_SMOKE_WRAPPER ? ["-a", executable] : [];
  const child = spawn(command, args, { env, stdio: "ignore" });
  const timeoutMs = Number(process.env.HARNESS_SMOKE_TIMEOUT_MS || 120_000);
  const deadline = Date.now() + timeoutMs;
  let duration = null;
  while (Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    duration = findNavigation(path.join(userRoot, "logs"));
    if (duration !== null) break;
  }
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 750));
  snapshotHarnessLogs(userRoot, index);
  if (duration === null) throw new Error(`launch ${index} did not reach navigation_complete within ${timeoutMs} ms`);
  console.log(`[smoke] launch ${index}: ${duration} ms`);
  return duration;
}

const coldRoots = [createColdRoot(1), createColdRoot(2), createColdRoot(3)];
const cold = [];
for (let index = 0; index < coldRoots.length; index += 1) cold.push(await launchOnce(`cold-${index + 1}`, coldRoots[index]));
cold.sort((a, b) => a - b);
const firstMedian = cold[1];
const warmRoot = coldRoots[2];
const warm = [await launchOnce("warm-1", warmRoot), await launchOnce("warm-2", warmRoot), await launchOnce("warm-3", warmRoot)].sort((a, b) => a - b);
const warmMedian = warm[1];
if (firstMedian > 15_000) throw new Error(`first launch median ${firstMedian} ms exceeds 15000 ms`);
if (warmMedian > 5_000) throw new Error(`warm launch median ${warmMedian} ms exceeds 5000 ms`);
fs.writeFileSync(path.resolve("startup-performance.json"), `${JSON.stringify({ coldLaunchSamplesMs: cold, coldP50Ms: firstMedian, coldP95Ms: cold[2], warmLaunchSamplesMs: warm, warmP50Ms: warmMedian, warmP95Ms: warm[2] }, null, 2)}\n`);
console.log("[smoke] startup performance gate passed");
