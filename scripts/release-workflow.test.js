import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("release workflow targets Windows and macOS desktop platforms", () => {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /x86_64-pc-windows-msvc/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /x86_64-apple-darwin/);
});
