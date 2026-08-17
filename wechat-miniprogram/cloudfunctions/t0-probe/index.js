"use strict";

const cloud = require("wx-server-sdk");
const runtime = require("./lib/runtime");
const gate = require("./lib/gate");
const probes = require("./lib/probes");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}, context = {}) => {
  const startedAt = Date.now();
  const action = runtime.resolveAction(event);
  const runId = event.runId || `t0probe_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;

  const gateResult = gate.evaluate({ event, action, runId, cloud, context });
  if (!gateResult.ok) {
    return {
      ok: false,
      status: "denied",
      evidenceId: runtime.evidenceId(action),
      action,
      runId,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      error: {
        code: gateResult.code,
        message: "t0-probe gate denied before any database write",
        reasons: gateResult.reasons,
      },
      data: null,
    };
  }

  const db = cloud.database();
  const _ = db.command;
  const meta = runtime.collectMeta(cloud, context, event, runId);
  let data = null;
  let error = null;
  let status = "completed";

  try {
    data = await probes.run(
      {
        cloud,
        db,
        _,
        runId,
        requestId: context.request_id || context.requestId || null,
      },
      action,
      event,
      runId,
    );
  } catch (probeError) {
    status = "error";
    error = runtime.normalizeError(probeError);
  }

  const finishedAt = Date.now();
  return {
    ok: status === "completed",
    status,
    evidenceId: runtime.evidenceId(action),
    action,
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    meta,
    data,
    error,
  };
};
