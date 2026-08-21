import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("deb smoke test validates and canonicalizes the local package path", () => {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /DEB=\$\(find[^\n]+-type f[^\n]+-name '\*\.deb'/);
  assert.match(workflow, /test -n "\$DEB"/);
  assert.match(workflow, /sudo apt-get install -y "\$\(realpath "\$DEB"\)"/);
});
