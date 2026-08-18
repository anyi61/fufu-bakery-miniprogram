import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("产品范围、Demo 边界和部署清单在文档中保持一致", async () => {
  const [readme, handoff, miniReadme, plan, manifest, landing] = await Promise.all([
    fs.readFile(new URL("README.md", root), "utf8"),
    fs.readFile(new URL("HANDOFF.md", root), "utf8"),
    fs.readFile(new URL("wechat-miniprogram/README.md", root), "utf8"),
    fs.readFile(new URL("docs/remediation-execution-plan.md", root), "utf8"),
    fs.readFile(new URL("wechat-miniprogram/cloudfunctions/deploy-manifest.json", root), "utf8"),
    fs.readFile(new URL("wechat-miniprogram/miniprogram/pages/landing/index.wxml", root), "utf8"),
  ]);
  for (const document of [readme, handoff, miniReadme, plan]) {
    assert.match(document, /Demo|演示/);
    assert.match(document, /自提/);
  }
  assert.doesNotMatch(handoff, /\d+\/\d+ 通过/);
  assert.match(landing, /hit-takeout[^>]+bindtap="comingSoon"/);
  assert.match(landing, /hit-express[^>]+bindtap="comingSoon"/);
  assert.deepEqual(JSON.parse(manifest).production, ["bakery", "payment"]);
});
