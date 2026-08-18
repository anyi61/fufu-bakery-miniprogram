"use strict";

const nodeCrypto = require("crypto");

const ACTION_ALLOWED_KEYS = Object.freeze({
  status: ["action", "operatorToken", "envId", "runId"],
  preflight: ["action", "operatorToken", "envId", "runId"],
  setup: ["action", "operatorToken", "envId", "runId"],
  cleanup: ["action", "operatorToken", "envId", "runId"],
  barrier: ["action", "operatorToken", "envId", "runId", "key", "participants", "leadMs"],
  d01: ["action", "operatorToken", "envId", "runId", "key", "caller", "participants", "method", "maxRetries"],
  d01_verify: ["action", "operatorToken", "envId", "runId", "key"],
  d02: ["action", "operatorToken", "envId", "runId", "method", "rollback"],
  d03: ["action", "operatorToken", "envId", "runId"],
  d04: ["action", "operatorToken", "envId", "runId", "mode", "method"],
  d05: ["action", "operatorToken", "envId", "runId"],
  d06: ["action", "operatorToken", "envId", "runId", "budget", "maxSearch"],
  d07: ["action", "operatorToken", "envId", "runId", "marker"],
  d08: ["action", "operatorToken", "envId", "runId"],
  d09: ["action", "operatorToken", "envId", "runId", "mode"],
  d10: ["action", "operatorToken", "envId", "runId"],
  d11: ["action", "operatorToken", "envId", "runId"],
  d12: ["action", "operatorToken", "envId", "runId", "samples"],
});

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const CALLER_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const MARKER_PATTERN = /^[A-Za-z0-9._:-]{1,48}$/;
const SAMPLE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const METHODS = new Set(["official-doc", "official-where", "raw-diagnostic"]);
const D04_MODES = new Set(["direct", "transaction"]);
const D09_MODES = new Set(["direct", "transaction"]);

function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return nodeCrypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function addReason(reasons, code, message) {
  reasons.push({ code, message });
}

function validateCommon(event, action, runId, reasons) {
  const allowed = ACTION_ALLOWED_KEYS[action];
  if (!allowed) {
    addReason(reasons, "UNKNOWN_ACTION", `action not allowed: ${action}`);
    return false;
  }
  const unknownKeys = Object.keys(event || {}).filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    addReason(reasons, "UNKNOWN_INPUT_KEYS", `unexpected input keys: ${unknownKeys.join(",")}`);
    return false;
  }
  if (runId && !RUN_ID_PATTERN.test(runId)) {
    addReason(reasons, "INVALID_RUN_ID", "runId must match [A-Za-z0-9._:-]{1,64}");
    return false;
  }
  if (event.envId !== undefined && !ID_PATTERN.test(String(event.envId))) {
    addReason(reasons, "INVALID_ENV_ID", "envId format invalid");
    return false;
  }
  return true;
}

function validateSamples(samples, reasons) {
  if (samples === undefined) return true;
  if (!Array.isArray(samples) || samples.length > 8) {
    addReason(reasons, "INVALID_SAMPLES", "samples must be an array of at most 8 items");
    return false;
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (typeof sample === "string") {
      if (sample.length < 1 || sample.length > 4000) {
        addReason(reasons, "INVALID_SAMPLE", `samples[${index}] JSON string length must be 1..4000`);
        return false;
      }
      try {
        JSON.parse(sample);
      } catch {
        addReason(reasons, "INVALID_SAMPLE_JSON", `samples[${index}] is not valid JSON`);
        return false;
      }
      continue;
    }
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
      addReason(reasons, "INVALID_SAMPLE", `samples[${index}] must be a JSON string or {name,json}`);
      return false;
    }
    const sampleKeys = Object.keys(sample);
    if (sampleKeys.some((key) => key !== "name" && key !== "json")) {
      addReason(reasons, "INVALID_SAMPLE_KEYS", `samples[${index}] may only contain name/json`);
      return false;
    }
    if (!SAMPLE_NAME_PATTERN.test(String(sample.name || ""))) {
      addReason(reasons, "INVALID_SAMPLE_NAME", `samples[${index}].name format invalid`);
      return false;
    }
    if (typeof sample.json !== "string" || sample.json.length < 1 || sample.json.length > 4000) {
      addReason(reasons, "INVALID_SAMPLE", `samples[${index}].json length must be 1..4000`);
      return false;
    }
    try {
      JSON.parse(sample.json);
    } catch {
      addReason(reasons, "INVALID_SAMPLE_JSON", `samples[${index}].json is not valid JSON`);
      return false;
    }
  }
  return true;
}

function validateActionInputs(event, action, reasons) {
  switch (action) {
    case "barrier":
      if (!KEY_PATTERN.test(String(event.key || ""))) {
        addReason(reasons, "INVALID_KEY", "key must match [A-Za-z0-9_-]{1,48}");
        return false;
      }
      if (!Number.isInteger(Number(event.participants)) || Number(event.participants) < 2 || Number(event.participants) > 8) {
        addReason(reasons, "INVALID_PARTICIPANTS", "participants must be an integer 2..8");
        return false;
      }
      if (!Number.isInteger(Number(event.leadMs)) || Number(event.leadMs) < 1000 || Number(event.leadMs) > 30000) {
        addReason(reasons, "INVALID_LEAD_MS", "leadMs must be an integer 1000..30000");
        return false;
      }
      return true;
    case "d01":
      if (!KEY_PATTERN.test(String(event.key || ""))) {
        addReason(reasons, "INVALID_KEY", "key must match [A-Za-z0-9_-]{1,48}");
        return false;
      }
      if (!CALLER_PATTERN.test(String(event.caller || ""))) {
        addReason(reasons, "INVALID_CALLER", "caller must match [A-Za-z0-9_-]{1,24}");
        return false;
      }
      if (!Number.isInteger(Number(event.participants)) || Number(event.participants) < 2 || Number(event.participants) > 8) {
        addReason(reasons, "INVALID_PARTICIPANTS", "participants must be an integer 2..8");
        return false;
      }
      if (!METHODS.has(event.method === undefined ? "official-doc" : event.method)) {
        addReason(reasons, "INVALID_METHOD", "method must be official-doc, official-where, or raw-diagnostic");
        return false;
      }
      if (!Number.isInteger(Number(event.maxRetries)) || Number(event.maxRetries) < 1 || Number(event.maxRetries) > 10) {
        addReason(reasons, "INVALID_MAX_RETRIES", "maxRetries must be an integer 1..10");
        return false;
      }
      return true;
    case "d01_verify":
      if (!KEY_PATTERN.test(String(event.key || ""))) {
        addReason(reasons, "INVALID_KEY", "key must match [A-Za-z0-9_-]{1,48}");
        return false;
      }
      return true;
    case "d02":
      if (!METHODS.has(event.method === undefined ? "official-doc" : event.method)) {
        addReason(reasons, "INVALID_METHOD", "method must be official-doc, official-where, or raw-diagnostic");
        return false;
      }
      if (event.rollback !== undefined && typeof event.rollback !== "boolean") {
        addReason(reasons, "INVALID_ROLLBACK", "rollback must be boolean");
        return false;
      }
      return true;
    case "d04":
      if (!D04_MODES.has(event.mode === undefined ? "direct" : event.mode)) {
        addReason(reasons, "INVALID_D04_MODE", "mode must be direct or transaction");
        return false;
      }
      if (!METHODS.has(event.method === undefined ? "official-doc" : event.method)) {
        addReason(reasons, "INVALID_METHOD", "method must be official-doc, official-where, or raw-diagnostic");
        return false;
      }
      return true;
    case "d06": {
      const budget = event.budget === undefined ? 40 : Number(event.budget);
      const maxSearch = event.maxSearch === undefined ? 256 : Number(event.maxSearch);
      if (!Number.isInteger(budget) || budget < 1 || budget > 512) {
        addReason(reasons, "INVALID_BUDGET", "budget must be an integer 1..512");
        return false;
      }
      if (!Number.isInteger(maxSearch) || maxSearch < 2 || maxSearch > 512) {
        addReason(reasons, "INVALID_MAX_SEARCH", "maxSearch must be an integer 2..512");
        return false;
      }
      if (budget > maxSearch) {
        addReason(reasons, "INVALID_BUDGET_RANGE", "budget must be <= maxSearch");
        return false;
      }
      return true;
    }
    case "d07":
      if (!MARKER_PATTERN.test(String(event.marker || ""))) {
        addReason(reasons, "INVALID_MARKER", "marker must match [A-Za-z0-9._:-]{1,48}");
        return false;
      }
      return true;
    case "d09":
      if (!D09_MODES.has(event.mode === undefined ? "direct" : event.mode)) {
        addReason(reasons, "INVALID_D09_MODE", "mode must be direct or transaction");
        return false;
      }
      return true;
    case "d12":
      return validateSamples(event.samples, reasons);
    default:
      return true;
  }
}

function runtimeEnvironment(cloud, context = {}) {
  const candidates = [
    ["context.namespace", context.namespace],
    ["context.namespace_id", context.namespace_id],
    ["context.environment", context.environment],
    ["process.env.SCF_NAMESPACE", process.env.SCF_NAMESPACE],
    ["process.env.TCB_ENV", process.env.TCB_ENV],
    ["process.env.CLOUDBASE_ENV_ID", process.env.CLOUDBASE_ENV_ID],
    ["process.env.WX_CLIENT_ENV", process.env.WX_CLIENT_ENV],
  ];
  try {
    const wxContext = cloud.getWXContext();
    candidates.push(["wxContext.ENV", wxContext.ENV || wxContext.env]);
  } catch {
    // getWXContext is unavailable for some CLI/SCF invocation paths.
  }
  for (const [source, value] of candidates) {
    if (typeof value === "string" && value.length > 0) {
      return { envId: value, source };
    }
  }
  return { envId: null, source: null };
}

function evaluate({ event, action, runId, cloud, context = {} }) {
  const reasons = [];
  const enabled = process.env.T0_PROBE_ENABLED === "true";
  const expectedEnvId = process.env.T0_PROBE_ENV_ID || "";
  const operatorToken = process.env.T0_PROBE_OPERATOR_TOKEN || "";

  if (!enabled) {
    addReason(reasons, "T0_PROBE_DISABLED", "T0_PROBE_ENABLED must be 'true'");
  }
  if (!ID_PATTERN.test(expectedEnvId)) {
    addReason(reasons, "T0_PROBE_ENV_NOT_CONFIGURED", "T0_PROBE_ENV_ID environment variable missing or invalid");
  }
  if (typeof operatorToken !== "string" || operatorToken.length < 16) {
    addReason(reasons, "T0_PROBE_OPERATOR_NOT_CONFIGURED", "T0_PROBE_OPERATOR_TOKEN must be at least 16 characters");
  }

  if (!validateCommon(event, action, runId, reasons) || !validateActionInputs(event, action, reasons)) {
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }
  if (reasons.length > 0) {
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }

  if (typeof event.operatorToken !== "string" || event.operatorToken.length < 16 || event.operatorToken.length > 256) {
    addReason(reasons, "INVALID_OPERATOR_TOKEN", "event.operatorToken length must be 16..256 characters");
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }
  if (!safeTokenEqual(event.operatorToken, operatorToken)) {
    addReason(reasons, "OPERATOR_NOT_AUTHORIZED", "operatorToken mismatch");
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }
  if (!event.envId || event.envId !== expectedEnvId) {
    addReason(reasons, "ENV_ID_MISMATCH", "event.envId must match T0_PROBE_ENV_ID");
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }

  const runtimeEnv = runtimeEnvironment(cloud, context);
  if (!runtimeEnv.envId) {
    addReason(reasons, "RUNTIME_ENV_UNAVAILABLE", "current function environment id is unavailable");
    return { ok: false, code: "T0_PROBE_DENIED", reasons, runtimeEnv };
  }
  if (runtimeEnv.envId !== expectedEnvId) {
    addReason(reasons, "RUNTIME_ENV_MISMATCH", "current function env does not match T0_PROBE_ENV_ID");
    return { ok: false, code: "T0_PROBE_DENIED", reasons, runtimeEnv };
  }

  if (event.endpoints !== undefined) {
    addReason(reasons, "D11_CUSTOM_ENDPOINTS_FORBIDDEN", "D11 endpoint list is fixed and cannot be supplied by caller");
    return { ok: false, code: "T0_PROBE_DENIED", reasons };
  }

  return { ok: true, code: "T0_PROBE_GATE_OK", reasons: [], runtimeEnv };
}

module.exports = {
  ACTION_ALLOWED_KEYS,
  evaluate,
  runtimeEnvironment,
  safeTokenEqual,
};
