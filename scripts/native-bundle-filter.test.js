import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneIncompatibleNativeBinaries } from "./native-bundle-filter.js";

function touch(root, relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "fixture");
}

test("Linux x64 glibc bundle excludes musl and foreign-architecture native binaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-bundle-filter-"));
  try {
    touch(root, "@koromix/koffi-linux-x64/linux_x64/koffi.node");
    touch(root, "@koromix/koffi-linux-x64/musl_x64/koffi.node");
    touch(root, "node-pty/prebuilds/linux-x64/pty.node");
    touch(root, "node-pty/prebuilds/linux-arm64/pty.node");

    const removed = pruneIncompatibleNativeBinaries(root, {
      platform: "linux",
      arch: "x64",
    });

    assert.equal(fs.existsSync(path.join(root, "@koromix/koffi-linux-x64/linux_x64/koffi.node")), true);
    assert.equal(fs.existsSync(path.join(root, "@koromix/koffi-linux-x64/musl_x64/koffi.node")), false);
    assert.equal(fs.existsSync(path.join(root, "node-pty/prebuilds/linux-x64/pty.node")), true);
    assert.equal(fs.existsSync(path.join(root, "node-pty/prebuilds/linux-arm64/pty.node")), false);
    assert.deepEqual(removed.sort(), [
      "@koromix/koffi-linux-x64/musl_x64",
      "node-pty/prebuilds/linux-arm64",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-Linux bundles are left unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-bundle-filter-"));
  try {
    touch(root, "node-pty/prebuilds/linux-arm64/pty.node");
    assert.deepEqual(pruneIncompatibleNativeBinaries(root, { platform: "win32", arch: "x64" }), []);
    assert.equal(fs.existsSync(path.join(root, "node-pty/prebuilds/linux-arm64/pty.node")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
