import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("customer and merchant surfaces expose the pickup-only business flow", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);
  assert.match(page, /小雨面包/);
  assert.match(page, /仅预约自提/);
  assert.match(page, /模拟微信支付/);
  assert.match(page, /门店工作台/);
  assert.match(page, /核销取货/);
  assert.doesNotMatch(page, /同城配送|配送地址|骑手/);
  assert.match(page, /D1 模拟业务 Demo/);
  assert.doesNotMatch(page + layout, /实时业务|真实库存|真实业务闭环/);
});

test("durable order flow has reservation, payment, audit and stock guards", async () => {
  const [store, schema, config] = await Promise.all([
    readFile(new URL("lib/store.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);
  assert.match(store, /reserved_stock = reserved_stock \+ \?/);
  assert.match(store, /reserved_stock = reserved_stock - \?, sold_stock = sold_stock \+ \?/);
  assert.match(store, /INSUFFICIENT_PRODUCT_STOCK/);
  assert.match(store, /order\.status_changed/);
  assert.match(schema, /integrationEvents/);
  assert.equal(JSON.parse(config).d1, "DB");
});

test("production integrations are isolated behind adapters", async () => {
  const adapters = await readFile(new URL("lib/adapters.ts", root), "utf8");
  for (const contract of ["PaymentAdapter", "NotificationAdapter", "PrintAdapter", "PospalAdapter"]) {
    assert.match(adapters, new RegExp(`interface ${contract}`));
  }
  assert.match(adapters, /demo-wechat-pay/);
  assert.match(adapters, /demo-pospal/);
});
