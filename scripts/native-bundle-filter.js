import fs from "node:fs";
import path from "node:path";

function listDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
}

/** Returns native dependency directories linuxdeploy must not inspect. */
export function findIncompatibleNativeBinaries(nodeModulesDir, target = process) {
  if (target.platform !== "linux") return [];

  const incompatible = [];
  const koffiPackage = path.join(nodeModulesDir, `@koromix/koffi-linux-${target.arch}`);
  for (const entry of listDirectories(koffiPackage)) {
    if (entry.name.startsWith("musl_")) incompatible.push(path.join(koffiPackage, entry.name));
  }

  const nodePtyPrebuilds = path.join(nodeModulesDir, "node-pty", "prebuilds");
  const expectedNodePtyPlatform = `linux-${target.arch}`;
  for (const entry of listDirectories(nodePtyPrebuilds)) {
    if (entry.name.startsWith("linux-") && entry.name !== expectedNodePtyPlatform) {
      incompatible.push(path.join(nodePtyPrebuilds, entry.name));
    }
  }

  return incompatible;
}

export function pruneIncompatibleNativeBinaries(nodeModulesDir, target = process) {
  const incompatible = findIncompatibleNativeBinaries(nodeModulesDir, target);
  for (const dir of incompatible) fs.rmSync(dir, { recursive: true, force: true });
  return incompatible.map((dir) => path.relative(nodeModulesDir, dir).split(path.sep).join("/"));
}
