import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../wechat-miniprogram/", import.meta.url);

test("微信小程序工程配置完整且首发范围只有预约自提", async () => {
  const [project, app, runtime, readme] = await Promise.all([
    readFile(new URL("project.config.json", root), "utf8"),
    readFile(new URL("miniprogram/app.json", root), "utf8"),
    readFile(new URL("miniprogram/config/runtime.js", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  assert.equal(JSON.parse(project).miniprogramRoot, "miniprogram/");
  assert.equal(JSON.parse(project).cloudfunctionRoot, "cloudfunctions/");
  assert.ok(JSON.parse(app).pages.includes("pages/merchant/index"));
  assert.match(runtime, /demoMode: true/);
  assert.match(readme, /预约到店自提/);
  assert.doesNotMatch(runtime, /AppSecret|API v3|PRIVATE KEY/);
});

test("所有小程序与云函数 JavaScript 均可解析", async () => {
  async function walk(url) {
    const entries = await readdir(url, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) files.push(...await walk(child)); else if (entry.name.endsWith(".js")) files.push(child);
    }
    return files;
  }
  for (const file of await walk(root)) {
    const source = await readFile(file, "utf8");
    assert.doesNotThrow(() => new Function(source), file.pathname);
  }
});

test("体验模式跑通预占、支付、门店状态和动态取餐码核销", async () => {
  let storage;
  global.wx = {
    getStorageSync: () => storage,
    setStorageSync: (_key, value) => { storage = structuredClone(value); },
    removeStorageSync: () => { storage = undefined; },
  };
  const require = createRequire(import.meta.url);
  const apiPath = new URL("miniprogram/services/api.js", root);
  const api = require(fileURLToPath(apiPath));
  api.resetDemo();
  const before = await api.bootstrap();
  const order = await api.reserveOrder({ slotId: 1, items: [{ productId: 1, quantity: 1 }], idempotencyKey: "test-order", remark: "测试" });
  assert.equal(order.status, "pending_payment");
  let snapshot = await api.bootstrap();
  assert.equal(snapshot.products[0].reservedStock, 1);
  const paid = await api.confirmPayment(order.id);
  assert.equal(paid.status, "pending_acceptance");
  snapshot = await api.bootstrap();
  assert.equal(snapshot.products[0].reservedStock, 0);
  assert.equal(snapshot.products[0].soldStock, before.products[0].soldStock + 1);
  await api.transitionOrder(order.id, "accepted");
  await api.transitionOrder(order.id, "making");
  await api.transitionOrder(order.id, "ready");
  await assert.rejects(api.transitionOrder(order.id, "completed", "A000"), /取餐码不正确/);
  const completed = await api.transitionOrder(order.id, "completed", order.pickupCodeRaw);
  assert.equal(completed.status, "completed");
  const soldOut = await api.setProductAvailability(2, true);
  assert.equal(soldOut.isSoldOut, true);
  api.resetDemo();
  delete global.wx;
});
