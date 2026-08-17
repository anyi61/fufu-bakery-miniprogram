"use strict";

const nodeCrypto = require("crypto");
const cloud = require("wx-server-sdk");
const gate = require("./lib/gate");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function markerId(time) {
  return `timer_${nodeCrypto.createHash("sha256").update(time).digest("hex").slice(0, 24)}`;
}

exports.main = async (event = {}, context = {}) => {
  const gateResult = gate.evaluate({ event, cloud, context });
  if (!gateResult.ok) {
    return {
      ok: false,
      status: "denied",
      evidenceId: "T0-D08",
      error: { code: gateResult.code, message: gateResult.message },
    };
  }

  // Database initialization deliberately occurs only after the timer gate passes.
  const db = cloud.database();
  const id = markerId(event.Time);
  await db.collection("t0probe_timer_log").doc(id).set({
    data: {
      probe: true,
      evidenceId: "T0-D08",
      triggerName: gate.TIMER_NAME,
      triggerTime: new Date(event.Time),
      observedAt: db.serverDate(),
      runtimeEnvSource: gateResult.runtimeEnv.source,
      requestId: context.request_id || context.requestId || null,
    },
  });
  return { ok: true, status: "marked", evidenceId: "T0-D08", markerId: id };
};

module.exports.markerId = markerId;
