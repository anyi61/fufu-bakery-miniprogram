"use strict";

const nodeCrypto = require("crypto");

const EVIDENCE_IDS = {
  status: "T0-SDK",
  preflight: "T0-D00-前置",
  barrier: "T0-D01-BARRIER",
  d01: "T0-D01",
  d01_verify: "T0-D01-VERIFY",
  d02: "T0-D02",
  d03: "T0-D03",
  d04: "T0-D04",
  d05: "T0-D05",
  d06: "T0-D06",
  d07: "T0-D07",
  d08: "T0-D08",
  d09: "T0-D09",
  d10: "T0-D10",
  d11: "T0-D11",
  d12: "T0-D12",
  setup: "T0-SETUP",
  cleanup: "T0-CLEANUP",
};

function evidenceId(action) {
  return EVIDENCE_IDS[action] || `T0-ACTION-${action}`;
}

function shortHash(value) {
  if (value === undefined || value === null || value === "") return null;
  return nodeCrypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function mask(value) {
  if (value === undefined || value === null || value === "") return value || null;
  const text = String(value);
  if (text.length <= 8) return `${text.length} chars`;
  return `${text.slice(0, 4)}***${text.slice(-2)}`;
}

function maskOpenId(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 8) return mask(text);
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeError(error) {
  if (!error) return null;
  const summary = {
    name: error.name || null,
    code: error.code || null,
    errCode: error.errCode || null,
    errMsg: error.errMsg || null,
    message: error.message ? String(error.message).slice(0, 1200) : null,
    requestId: error.requestId || null,
    stack: error.stack ? String(error.stack).split("\n").slice(0, 8).join("\n") : null,
  };
  if (error.raw && typeof error.raw === "object") {
    try {
      summary.raw = JSON.parse(JSON.stringify(error.raw));
    } catch {
      summary.raw = String(error.raw).slice(0, 1200);
    }
  }
  return summary;
}

function resolveAction(event) {
  const source = event || {};
  const timerType = String(source.Type || source.type || "").toLowerCase();
  if (timerType === "timer" || source.TriggerName || source.triggerName) {
    return "d08";
  }
  return source.action || "status";
}

function collectMeta(cloud, context, event, runId) {
  const meta = {
    runId,
    startedAt: nowIso(),
    node: process.version,
    platform: process.platform,
    versions: {},
    wxContext: null,
    processEnvKeys: Object.keys(process.env).sort(),
    context: {
      requestId: context && (context.request_id || context.requestId) ? (context.request_id || context.requestId) : null,
      memoryLimitInMb: context && context.memory_limit_in_mb ? context.memory_limit_in_mb : null,
      timeLimitInMs: context && context.time_limit_in_ms ? context.time_limit_in_ms : null,
      functionName: context && context.function_name ? context.function_name : null,
      namespaceMasked: mask(
        context && (context.namespace || context.namespace_id || context.environment),
      ),
    },
    actionInputKeys: Object.keys(event || {}).sort(),
  };

  try {
    meta.versions.wxServerSdk = require("wx-server-sdk/package.json").version;
  } catch (error) {
    meta.versions.wxServerSdkError = normalizeError(error);
  }
  for (const name of ["@cloudbase/node-sdk", "@cloudbase/database", "axios", "lodash.set", "lodash.unset"]) {
    try {
      meta.versions[name] = require(`${name}/package.json`).version;
    } catch {
      meta.versions[name] = null;
    }
  }

  try {
    const ctx = cloud.getWXContext();
    meta.wxContext = {
      keys: Object.keys(ctx).sort(),
      openIdMasked: maskOpenId(ctx.OPENID),
      appIdMasked: mask(ctx.APPID),
      unionIdMasked: mask(ctx.UNIONID),
      envMasked: mask(ctx.ENV || ctx.env),
    };
  } catch (error) {
    meta.wxContextError = normalizeError(error);
  }

  meta.envMasked = mask(
    (context && (context.namespace || context.namespace_id || context.environment)) ||
      process.env.SCF_NAMESPACE ||
      process.env.TCB_ENV ||
      process.env.WX_CLIENT_ENV ||
      process.env.CLOUDBASE_ENV_ID,
  );

  return meta;
}

function transactionConflict(message) {
  const error = new Error(message || "DATABASE_TRANSACTION_CONFLICT");
  error.code = "DATABASE_TRANSACTION_CONFLICT";
  return error;
}

function forcedRollback(message) {
  const error = new Error(message || "T0_FORCED_ROLLBACK");
  error.code = "T0_FORCED_ROLLBACK";
  return error;
}

function allSettled(promises) {
  return Promise.all(
    promises.map((promise) =>
      Promise.resolve(promise).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason: normalizeError(reason) }),
      ),
    ),
  );
}

module.exports = {
  EVIDENCE_IDS,
  evidenceId,
  shortHash,
  mask,
  maskOpenId,
  nowIso,
  sleep,
  normalizeError,
  resolveAction,
  collectMeta,
  transactionConflict,
  forcedRollback,
  allSettled,
};
