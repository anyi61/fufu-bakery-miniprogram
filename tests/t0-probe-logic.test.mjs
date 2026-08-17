import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const probes = require("../wechat-miniprogram/cloudfunctions/t0-probe/lib/probes.js");
const dbHelper = require("../wechat-miniprogram/cloudfunctions/t0-probe/lib/db.js");

test("T0 正式事务路径固定为公开 official-doc，raw 只映射到诊断路径", () => {
  assert.equal(probes.__test.transactionPath(undefined), "official-doc");
  assert.equal(probes.__test.transactionPath("official"), "official-doc");
  assert.equal(probes.__test.transactionPath("official-where"), "official-where");
  assert.equal(probes.__test.transactionPath("raw"), "raw-diagnostic");
});

test("D01 单参与者或诊断路径不得形成正式并发通过证据", () => {
  const fulfilled = { status: "fulfilled" };
  const verified = { pass: true };
  assert.equal(probes.__test.evaluateD01FormalPass({ participants: 1, claim: fulfilled, verification: verified, method: "official-doc" }), false);
  assert.equal(probes.__test.evaluateD01FormalPass({ participants: 2, claim: fulfilled, verification: verified, method: "raw-diagnostic" }), false);
  assert.equal(probes.__test.evaluateD01FormalPass({ participants: 2, claim: fulfilled, verification: verified, method: "official-doc" }), true);
});

test("txDocGet 只访问公开事务对象，不读取 _transaction", async () => {
  const tx = {
    get _transaction() {
      throw new Error("private transaction internals must not be read");
    },
    collection(name) {
      assert.equal(name, "orders");
      return {
        doc(id) {
          assert.equal(id, "order-1");
          return { get: async () => ({ data: { _id: id, version: 1 }, requestId: "req-public" }) };
        },
      };
    },
  };
  const result = await dbHelper.txDocGet(tx, "orders", "order-1");
  assert.equal(result.requestId, "req-public");
  assert.equal(result.data.version, 1);
});

test("D06 达到搜索上限只证明预算，不算已测明平台边界", () => {
  const evidence = probes.__test.evaluateD06Evidence({
    seeding: { ok: true },
    writeBudget: { ok: true },
    readBudget: { ok: true, missing: 0 },
    writeLimit: { maxKnown: 256, searchCappedAt: true, edge: null, log: [] },
    readLimit: { maxKnown: 256, searchCappedAt: true, edge: null, log: [] },
    budget: 40,
  });
  assert.equal(evidence.budgetPass, true);
  assert.equal(evidence.limitCharacterized, false);
  assert.equal(evidence.pass, false);
});

test("D06 预算通过且读写首个失败边界均有证据时才整体通过", () => {
  const evidence = probes.__test.evaluateD06Evidence({
    seeding: { ok: true },
    writeBudget: { ok: true },
    readBudget: { ok: true, missing: 0 },
    writeLimit: { maxKnown: 80, edge: { ok: false }, log: [] },
    readLimit: { maxKnown: 100, edge: { ok: false }, log: [{ missing: 0 }] },
    budget: 40,
  });
  assert.deepEqual(
    { budgetPass: evidence.budgetPass, limitCharacterized: evidence.limitCharacterized, pass: evidence.pass },
    { budgetPass: true, limitCharacterized: true, pass: true },
  );
});

test("D10 使用固定 UTC 基准，不受 setup 到执行之间等待时长影响", () => {
  assert.equal(new Date(probes.__test.D10_BASELINE_MS).toISOString(), "2020-01-02T00:00:00.000Z");
});

test("D09 official-doc 在事务内校验 version、owner 和到期边界", () => {
  const now = Date.parse("2020-01-02T00:00:00.000Z");
  const lease = { version: 2, ownerId: "owner-a", leaseExpiresAt: new Date(now) };
  assert.equal(probes.__test.leasePreconditionFailure(lease, 2, "owner-a", true, now), null);
  assert.equal(probes.__test.leasePreconditionFailure({ ...lease, leaseExpiresAt: new Date(now + 1) }, 2, null, true, now).reason, "lease-not-expired");
  assert.equal(probes.__test.leasePreconditionFailure(lease, 1, null, false, now).reason, "version-mismatch");
  assert.equal(probes.__test.leasePreconditionFailure(lease, 2, "owner-b", false, now).reason, "owner-mismatch");
});
