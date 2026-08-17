"use strict";

const ENV_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TIMER_EVENT_KEYS = new Set(["Message", "Time", "TriggerName", "Type"]);
const TIMER_NAME = "t0probe-timer";

function deny(code, message, runtimeEnv = null) {
  return { ok: false, code, message, runtimeEnv };
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
    // Timer invocations need not expose a WeChat context.
  }
  for (const [source, value] of candidates) {
    if (typeof value === "string" && value.length > 0) return { envId: value, source };
  }
  return { envId: null, source: null };
}

function validateTimerTime(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 3 * 60 * 1000) return false;
  return new Date(timestamp).getUTCMinutes() % 5 === 0;
}

function evaluate({ event, cloud, context = {}, now = Date.now() }) {
  if (process.env.T0_PROBE_ENABLED !== "true") {
    return deny("T0_PROBE_DISABLED", "T0_PROBE_ENABLED must be 'true'");
  }
  const expectedEnvId = process.env.T0_PROBE_ENV_ID || "";
  if (!ENV_ID_PATTERN.test(expectedEnvId)) {
    return deny("T0_PROBE_ENV_NOT_CONFIGURED", "T0_PROBE_ENV_ID is missing or invalid");
  }
  const unknownKeys = Object.keys(event || {}).filter((key) => !TIMER_EVENT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return deny("UNKNOWN_INPUT_KEYS", `unexpected timer input keys: ${unknownKeys.join(",")}`);
  }
  if (
    event.Type !== "Timer" ||
    event.TriggerName !== TIMER_NAME ||
    event.Message !== "" ||
    !validateTimerTime(event.Time, now)
  ) {
    return deny("INVALID_TIMER_EVENT", "event must match the exact t0probe-timer event contract");
  }
  const runtimeEnv = runtimeEnvironment(cloud, context);
  if (!runtimeEnv.envId) {
    return deny("RUNTIME_ENV_UNAVAILABLE", "trusted runtime environment ID is unavailable", runtimeEnv);
  }
  if (runtimeEnv.envId !== expectedEnvId) {
    return deny("RUNTIME_ENV_MISMATCH", "runtime environment does not match T0_PROBE_ENV_ID", runtimeEnv);
  }
  return { ok: true, code: "T0_PROBE_TIMER_GATE_OK", runtimeEnv };
}

module.exports = {
  TIMER_EVENT_KEYS,
  TIMER_NAME,
  evaluate,
  runtimeEnvironment,
  validateTimerTime,
};
