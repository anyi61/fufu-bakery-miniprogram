import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { evaluateMerchantAccess } from "../lib/merchant-auth.js";

const root = process.cwd();
const require = createRequire(import.meta.url);
const validation = require(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/validation.js"));

test("reserveOrder 输入契约拒绝异常数量并聚合重复 SKU", () => {
  const normalized = validation.normalizeReserveInput({
    slotId: "20260818_1540",
    items: [{ productId: 1, quantity: 2 }, { productId: "1", quantity: 3 }],
    remark: "  少糖  ",
    idempotencyKey: "wx_20260818_abcdef",
  });
  assert.deepEqual(normalized.items, [{ productId: "1", quantity: 5 }]);
  assert.equal(normalized.remark, "少糖");

  for (const quantity of [-1, 0, 1.5, "2", Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => validation.normalizeReserveInput({
      slotId: "20260818_1540",
      items: [{ productId: 1, quantity }],
      idempotencyKey: "wx_20260818_abcdef",
    }), /商品数量无效/);
  }
  assert.throws(() => validation.normalizeReserveInput({
    slotId: "20260818_1540",
    items: [{ productId: 1, quantity: 11 }, { productId: 1, quantity: 10 }],
    idempotencyKey: "wx_20260818_abcdef",
  }), /单个商品数量超限/);
});

test("reserveOrder 在任何清理和数据库写入前验证输入", () => {
  const source = fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/index.js"), "utf8");
  const start = source.indexOf("async function reserveOrder");
  const normalized = source.indexOf("normalizeReserveInput(input)", start);
  const cleanup = source.indexOf("releaseExpiredReservations()", start);
  const transaction = source.indexOf("runTransaction", start);
  assert.ok(start >= 0 && normalized > start);
  assert.ok(normalized < cleanup);
  assert.ok(normalized < transaction);
  assert.match(source, /for \(const item of normalized\.items\)/);
});

test("库存和时段快照必须满足非负安全整数不变量", () => {
  assert.doesNotThrow(() => validation.requireStockSnapshot({ priceCents: 1200, plannedStock: 10, soldStock: 2, reservedStock: 3 }));
  assert.throws(() => validation.requireStockSnapshot({ priceCents: 1200, plannedStock: 10, soldStock: 8, reservedStock: 3 }), /库存数据异常/);
  assert.throws(() => validation.requireStockSnapshot({ priceCents: -1, plannedStock: 10, soldStock: 0, reservedStock: 0 }), /库存数据异常/);
  assert.doesNotThrow(() => validation.requireSlotSnapshot({ capacity: 12, paidCount: 3, reservedCount: 2 }));
  assert.throws(() => validation.requireSlotSnapshot({ capacity: 12, paidCount: 8, reservedCount: 5 }), /时段数据异常/);
});

function loadSeed(env) {
  const source = fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/seed/index.js"), "utf8");
  let databaseCalls = 0;
  let writes = 0;
  const db = {
    serverDate: () => new Date(),
    collection() {
      return {
        where() {
          return { limit() { return { async get() { return { data: [] }; } }; } };
        },
        doc() {
          return { async set() { writes += 1; } };
        },
      };
    },
  };
  const cloud = {
    DYNAMIC_CURRENT_ENV: Symbol("dynamic"),
    init() {},
    getWXContext() { return { OPENID: "ordinary-user", ENV: env.RUNTIME_ENV }; },
    database() { databaseCalls += 1; return db; },
  };
  const moduleStub = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleStub,
    exports: moduleStub.exports,
    Buffer,
    Date,
    process: { env },
    require(name) {
      if (name === "node:crypto") return require("node:crypto");
      if (name === "wx-server-sdk") return cloud;
      throw new Error("unexpected require: " + name);
    },
  });
  return { main: moduleStub.exports.main, counters: () => ({ databaseCalls, writes }) };
}

test("seed 默认关闭并在数据库访问前拒绝", async () => {
  const seed = loadSeed({});
  await assert.rejects(seed.main({ action: "apply", operatorToken: "x".repeat(32) }, {}), /SEED_DISABLED/);
  assert.deepEqual(seed.counters(), { databaseCalls: 0, writes: 0 });
});

test("seed 不得创建首个 owner，且拒绝后零写入", async () => {
  const token = "a".repeat(32);
  const seed = loadSeed({
    SEED_ENABLED: "true",
    SEED_ENV_ID: "isolated-test",
    SEED_OPERATOR_TOKEN: token,
    RUNTIME_ENV: "isolated-test",
  });
  await assert.rejects(seed.main({ action: "apply", operatorToken: token }, {}), /SEED_OWNER_REQUIRED/);
  assert.deepEqual(seed.counters(), { databaseCalls: 1, writes: 0 });
  const source = fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/seed/index.js"), "utf8");
  assert.doesNotMatch(source, /staff\.add|role:\s*["']owner["'].*createdAt/);
});

test("生产云函数清单排除 seed 和 T0 探针", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/deploy-manifest.json"), "utf8"));
  assert.deepEqual(manifest.production, ["bakery", "payment"]);
  assert.ok(manifest.excluded.includes("seed"));
  assert.ok(manifest.excluded.includes("t0-probe"));
  assert.ok(manifest.excluded.includes("t0-probe-timer"));
  assert.equal(manifest.production.some((name) => manifest.excluded.includes(name)), false);
});

test("商户 API 默认关闭并拒绝匿名或非白名单身份", () => {
  const allowedUserIds = new Set(["trusted-owner"]);
  assert.deepEqual(
    evaluateMerchantAccess({ enabled: false, allowedUserIds, userId: "trusted-owner", email: "owner@example.com" }),
    { ok: false, status: 403, message: "商户 API 未启用" },
  );
  assert.deepEqual(
    evaluateMerchantAccess({ enabled: true, allowedUserIds, userId: null, email: null }),
    { ok: false, status: 401, message: "请先登录" },
  );
  assert.deepEqual(
    evaluateMerchantAccess({ enabled: true, allowedUserIds, userId: "forged-merchant", email: "attacker@example.com" }),
    { ok: false, status: 403, message: "需要门店权限" },
  );
  assert.deepEqual(
    evaluateMerchantAccess({ enabled: true, allowedUserIds, userId: "trusted-owner", email: "owner@example.com" }),
    { ok: true, actor: { userId: "trusted-owner", email: "owner@example.com" } },
  );
});

test("所有 Site 商户读写路由使用服务端商户门禁", () => {
  const routeFiles = [
    "app/api/bootstrap/route.ts",
    "app/api/orders/[id]/route.ts",
    "app/api/orders/[id]/transition/route.ts",
    "app/api/products/[id]/availability/route.ts",
  ];
  for (const file of routeFiles) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /merchantActorFromRequest\(request\)/, file);
    assert.doesNotMatch(source, /x-xiaoyu-role/, file);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, "app/page.tsx"), "utf8"), /x-xiaoyu-role/);
});

test("CloudBase 模拟支付默认关闭并绑定隔离环境", () => {
  const source = fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/index.js"), "utf8");
  assert.match(source, /ALLOW_DEMO_PAYMENT/);
  assert.match(source, /DEMO_PAYMENT_ENV_ID/);
  assert.match(source, /actualEnvironment !== expectedEnvironment/);
});
