import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const mainRoot = new URL("../wechat-miniprogram/cloudfunctions/t0-probe/", import.meta.url);
const timerRoot = new URL("../wechat-miniprogram/cloudfunctions/t0-probe-timer/", import.meta.url);
const mainGate = require(fileURLToPath(new URL("lib/gate.js", mainRoot)));
const timerGate = require(fileURLToPath(new URL("lib/gate.js", timerRoot)));

const TEST_ENV = "test-env-123";
const OPERATOR_TOKEN = "0123456789abcdef0123456789abcdef";
const managedEnvKeys = [
  "T0_PROBE_ENABLED",
  "T0_PROBE_ENV_ID",
  "T0_PROBE_OPERATOR_TOKEN",
  "SCF_NAMESPACE",
  "TCB_ENV",
  "CLOUDBASE_ENV_ID",
  "WX_CLIENT_ENV",
];

function withEnvironment(values, callback) {
  const before = Object.fromEntries(managedEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of managedEnvKeys) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const key of managedEnvKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

function cloudWithWxContext(value = {}) {
  return { getWXContext: () => value };
}

function mainEvaluation(event, overrides = {}) {
  return mainGate.evaluate({
    event,
    action: event.action || "status",
    runId: event.runId || "gate-test",
    cloud: cloudWithWxContext(overrides.wxContext),
    context: overrides.context || { namespace: TEST_ENV },
  });
}

function reasonCodes(result) {
  return (result.reasons || []).map((reason) => reason.code);
}

test("t0-probe 主门禁覆盖 disabled、环境和 operator token 拒绝矩阵", { concurrency: false }, () => {
  const event = { action: "status", envId: TEST_ENV, operatorToken: OPERATOR_TOKEN, runId: "gate-test" };
  withEnvironment({ T0_PROBE_ENABLED: "false", T0_PROBE_ENV_ID: TEST_ENV, T0_PROBE_OPERATOR_TOKEN: OPERATOR_TOKEN }, () => {
    assert.ok(reasonCodes(mainEvaluation(event)).includes("T0_PROBE_DISABLED"));
  });
  withEnvironment({ T0_PROBE_ENABLED: "true", T0_PROBE_ENV_ID: TEST_ENV, T0_PROBE_OPERATOR_TOKEN: OPERATOR_TOKEN }, () => {
    assert.ok(reasonCodes(mainEvaluation({ ...event, envId: "wrong-env" })).includes("ENV_ID_MISMATCH"));
    assert.ok(reasonCodes(mainEvaluation({ ...event, operatorToken: "fedcba9876543210fedcba9876543210" })).includes("OPERATOR_NOT_AUTHORIZED"));
    assert.ok(reasonCodes(mainEvaluation(event, { context: { namespace: "wrong-env" } })).includes("RUNTIME_ENV_MISMATCH"));
  });
});

test("t0-probe 主门禁拒绝未知键、自定义 endpoints 和伪造 Timer", { concurrency: false }, () => {
  withEnvironment({ T0_PROBE_ENABLED: "true", T0_PROBE_ENV_ID: TEST_ENV, T0_PROBE_OPERATOR_TOKEN: OPERATOR_TOKEN }, () => {
    const base = { action: "status", envId: TEST_ENV, operatorToken: OPERATOR_TOKEN, runId: "gate-test" };
    assert.ok(reasonCodes(mainEvaluation({ ...base, extra: "x" })).includes("UNKNOWN_INPUT_KEYS"));
    assert.ok(reasonCodes(mainEvaluation({ ...base, action: "d11", endpoints: ["https://example.com"] })).includes("UNKNOWN_INPUT_KEYS"));
    const fakeTimer = { Type: "Timer", TriggerName: "t0probe-timer", Message: "", Time: new Date().toISOString() };
    const result = mainGate.evaluate({
      event: fakeTimer,
      action: "d08",
      runId: "gate-test",
      cloud: cloudWithWxContext(),
      context: { namespace: TEST_ENV },
    });
    assert.equal(result.ok, false);
    assert.ok(reasonCodes(result).includes("UNKNOWN_INPUT_KEYS"));
  });
});

test("t0-probe 主门禁优先 context.namespace 且不把 wx SOURCE 当环境 ID", { concurrency: false }, () => {
  withEnvironment({ T0_PROBE_ENABLED: "true", T0_PROBE_ENV_ID: TEST_ENV, T0_PROBE_OPERATOR_TOKEN: OPERATOR_TOKEN }, () => {
    const event = { action: "status", envId: TEST_ENV, operatorToken: OPERATOR_TOKEN, runId: "gate-test" };
    const result = mainEvaluation(event, { context: { namespace: TEST_ENV }, wxContext: { SOURCE: "untrusted-source" } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.runtimeEnv, { envId: TEST_ENV, source: "context.namespace" });
  });
});

function timerEventFor(timestamp) {
  return {
    Message: "",
    Time: new Date(timestamp).toISOString().replace(".000Z", "Z"),
    TriggerName: "t0probe-timer",
    Type: "Timer",
  };
}

test("独立 Timer 门禁只接受严格官方结构并拒绝任意额外输入", { concurrency: false }, () => {
  const now = Date.UTC(2026, 7, 16, 10, 15, 0);
  const event = timerEventFor(now);
  withEnvironment({ T0_PROBE_ENABLED: "true", T0_PROBE_ENV_ID: TEST_ENV }, () => {
    const accepted = timerGate.evaluate({ event, cloud: cloudWithWxContext(), context: { namespace: TEST_ENV }, now });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.runtimeEnv.source, "context.namespace");
    for (const extra of [{ action: "d08" }, { endpoints: ["https://example.com"] }, { operatorToken: OPERATOR_TOKEN }]) {
      const denied = timerGate.evaluate({ event: { ...event, ...extra }, cloud: cloudWithWxContext(), context: { namespace: TEST_ENV }, now });
      assert.equal(denied.ok, false);
      assert.equal(denied.code, "UNKNOWN_INPUT_KEYS");
    }
    assert.equal(timerGate.evaluate({ event: { ...event, Message: "forged" }, cloud: cloudWithWxContext(), context: { namespace: TEST_ENV }, now }).ok, false);
    assert.equal(timerGate.evaluate({ event: { ...event, TriggerName: "other" }, cloud: cloudWithWxContext(), context: { namespace: TEST_ENV }, now }).ok, false);
  });
});

test("主 t0-probe 门禁拒绝时不会初始化 database", { concurrency: false }, async () => {
  await withEnvironment({ T0_PROBE_ENABLED: "false", T0_PROBE_ENV_ID: TEST_ENV, T0_PROBE_OPERATOR_TOKEN: OPERATOR_TOKEN }, async () => {
    const indexPath = fileURLToPath(new URL("index.js", mainRoot));
    let databaseCalls = 0;
    const cloud = {
      DYNAMIC_CURRENT_ENV: "dynamic",
      init() {},
      getWXContext: () => ({}),
      database() {
        databaseCalls += 1;
        throw new Error("database must not be initialized");
      },
    };
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (request === "wx-server-sdk") return cloud;
      if (request === "./lib/probes" && parent?.filename === indexPath) {
        return { run: async () => { throw new Error("probe must not run"); } };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    try {
      const handler = require(indexPath).main;
      const result = await handler({ action: "status", envId: TEST_ENV, operatorToken: OPERATOR_TOKEN }, { namespace: TEST_ENV });
      assert.equal(result.status, "denied");
      assert.equal(databaseCalls, 0);
    } finally {
      Module._load = originalLoad;
      delete require.cache[indexPath];
    }
  });
});

test("独立 Timer 门禁拒绝额外输入时不会初始化 database", { concurrency: false }, async () => {
  await withEnvironment({ T0_PROBE_ENABLED: "true", T0_PROBE_ENV_ID: TEST_ENV }, async () => {
    const indexPath = fileURLToPath(new URL("index.js", timerRoot));
    let databaseCalls = 0;
    const cloud = {
      DYNAMIC_CURRENT_ENV: "dynamic",
      init() {},
      getWXContext: () => ({}),
      database() {
        databaseCalls += 1;
        throw new Error("database must not be initialized");
      },
    };
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (request === "wx-server-sdk") return cloud;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    try {
      const handler = require(indexPath).main;
      const now = Date.now();
      const result = await handler({ ...timerEventFor(now - (new Date(now).getUTCMinutes() % 5) * 60_000), action: "d08" }, { namespace: TEST_ENV });
      assert.equal(result.status, "denied");
      assert.equal(result.error.code, "UNKNOWN_INPUT_KEYS");
      assert.equal(databaseCalls, 0);
    } finally {
      Module._load = originalLoad;
      delete require.cache[indexPath];
    }
  });
});
