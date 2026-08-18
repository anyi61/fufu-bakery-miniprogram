import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const ledger = require(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/ledger.js"));
const authz = require(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/authz.js"));

test("库存计划使用门店、履约日期和 SKU 确定性隔离", () => {
  const current = ledger.inventoryPlanId("store-1", "2026-08-19", "sku-1");
  assert.equal(current, "store-1__2026-08-19__sku-1");
  assert.notEqual(current, ledger.inventoryPlanId("store-2", "2026-08-19", "sku-1"));
  assert.notEqual(current, ledger.inventoryPlanId("store-1", "2026-08-20", "sku-1"));
  assert.notEqual(current, ledger.inventoryPlanId("store-1", "2026-08-19", "sku-2"));
});

test("库存和时段台账守恒检查拒绝负值、超卖和超容量", () => {
  const inventory = { plannedStock: 20, reservedUnits: 4, soldUnits: 10, version: 2 };
  assert.equal(ledger.availableUnits(inventory), 6);
  assert.doesNotThrow(() => ledger.assertInventoryPlan(inventory, 6));
  assert.throws(() => ledger.assertInventoryPlan(inventory, 7), /库存不足/);
  assert.throws(() => ledger.assertInventoryPlan({ ...inventory, reservedUnits: 11 }), /库存数据异常/);

  const slot = { capacity: 12, reservedOrders: 2, paidOrders: 9, version: 1, isClosed: false };
  assert.equal(ledger.availableOrders(slot), 1);
  assert.doesNotThrow(() => ledger.assertSlotPlan(slot));
  const fullSlot = { ...slot, reservedOrders: 3 };
  assert.throws(() => ledger.assertSlotPlan(fullSlot), /时段已约满/);
  assert.doesNotThrow(() => ledger.assertSlotPlan(fullSlot, false));
});

test("CloudBase 订单路径以预占事实和台账集合为权威数据", () => {
  const source = fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/bakery/index.js"), "utf8");
  for (const collection of ["inventory_plans", "slot_plans", "order_reservations", "order_idempotency"]) {
    assert.match(source, new RegExp(`collection\\("${collection}"\\)`));
  }
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /state: "reserved"/);
  assert.match(source, /state: "settled_paid"/);
  assert.match(source, /state: "released_timeout"/);
  const reserveStart = source.indexOf("async function reserveOrder");
  const confirmStart = source.indexOf("async function confirmDemoPayment");
  assert.doesNotMatch(source.slice(reserveStart, confirmStart), /pickupCode\(\)/);
});

test("CloudBase 员工权限按角色和门店双重约束", () => {
  const base = { active: true, storeId: "store_xiaoyu_001" };
  assert.equal(authz.hasPermission({ ...base, role: "owner" }, "staff.manage", base.storeId), true);
  assert.equal(authz.hasPermission({ ...base, role: "manager" }, "inventory.adjust", base.storeId), true);
  assert.equal(authz.hasPermission({ ...base, role: "operator" }, "order.make", base.storeId), true);
  assert.equal(authz.hasPermission({ ...base, role: "operator" }, "inventory.adjust", base.storeId), false);
  assert.equal(authz.hasPermission({ ...base, role: "clerk" }, "pickup.verify", base.storeId), true);
  assert.equal(authz.hasPermission({ ...base, role: "clerk" }, "order.accept", base.storeId), false);
  assert.equal(authz.hasPermission({ ...base, role: "owner", storeId: "other" }, "staff.manage", base.storeId), false);
  assert.equal(authz.hasPermission({ ...base, role: "owner", active: false }, "staff.manage", base.storeId), false);
  assert.equal(authz.permissionForTransition("completed"), "pickup.verify");
  assert.equal(authz.permissionForTransition("cancelled"), null);
});
