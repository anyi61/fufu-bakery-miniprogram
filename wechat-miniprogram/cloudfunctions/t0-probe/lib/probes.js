"use strict";

const http = require("http");
const https = require("https");
const dbHelper = require("./db");
const runtime = require("./runtime");

const {
  COLLECTIONS,
  COLLECTION_NAMES,
  txDocGet,
  txDocSet,
  txDocUpdate,
  txOfficialDocVersionUpdate,
  txWhereUpdate,
  ensureDoc,
  readDoc,
  preflightTxWhereUpdate,
} = dbHelper;

function dateMs(value, fallback) {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isNaN(milliseconds) ? fallback : milliseconds;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

function isDateObject(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function docSummary(doc, fields) {
  if (!doc) return null;
  const result = {};
  for (const field of fields) {
    result[field] = doc[field] === undefined ? null : doc[field];
  }
  return result;
}

function requestIdsFrom(readLog) {
  return (readLog || []).map((item) => item.requestId).filter(Boolean);
}

function transactionPath(method) {
  if (method === "raw" || method === "raw-diagnostic") return "raw-diagnostic";
  if (method === "official-where") return "official-where";
  return "official-doc";
}

function evaluateD01FormalPass({ participants, claim, verification, method }) {
  return Boolean(
    Number(participants) >= 2 &&
      claim &&
      claim.status === "fulfilled" &&
      verification &&
      verification.pass &&
      method === "official-doc",
  );
}

async function txVersionUpdate(tx, collectionName, docId, expectedVersion, data, method) {
  const path = transactionPath(method);
  if (path === "official-doc") {
    return txOfficialDocVersionUpdate(tx, collectionName, docId, expectedVersion, data);
  }
  return txWhereUpdate(tx, collectionName, { _id: docId, version: expectedVersion }, data, path);
}

async function removeAllDocs(db, collectionName) {
  let bulkRemoved = 0;
  const bulkErrors = [];
  const failures = [];
  let pages = 0;
  let finalCount = null;

  while (pages < 100) {
    pages += 1;
    try {
      const bulk = await db.collection(collectionName).where({ probe: true }).remove();
      bulkRemoved += bulk.stats.removed || 0;
    } catch (error) {
      bulkErrors.push(runtime.normalizeError(error));
    }

    const result = await db.collection(collectionName).limit(1000).get();
    const docs = result.data || [];
    if (docs.length === 0) {
      finalCount = 0;
      break;
    }

    let removedThisPage = 0;
    for (const doc of docs) {
      try {
        await db.collection(collectionName).doc(doc._id).remove();
        removedThisPage += 1;
      } catch (error) {
        failures.push({ _id: doc._id, error: runtime.normalizeError(error) });
      }
    }
    if (removedThisPage === 0 && failures.length > 0) {
      finalCount = docs.length;
      break;
    }
  }

  return {
    collection: collectionName,
    bulkRemoved,
    bulkErrors,
    failures,
    pages,
    finalCount,
    pass: finalCount === 0 && bulkErrors.length === 0 && failures.length === 0,
  };
}

async function setupCollections(ctx) {
  const created = [];
  const alreadyExisted = [];
  const failed = [];
  for (const collectionName of COLLECTION_NAMES) {
    try {
      await ctx.db.createCollection(collectionName);
      created.push(collectionName);
    } catch (error) {
      const normalized = runtime.normalizeError(error);
      const text = `${normalized.code || ""} ${normalized.errCode || ""} ${normalized.errMsg || ""} ${normalized.message || ""}`;
      if (/already exists|已存在|exist/i.test(text)) {
        alreadyExisted.push(collectionName);
      } else {
        failed.push({ collection: collectionName, error: normalized });
      }
    }
  }

  const now = new Date();
  const baseOrder = {
    version: 1,
    activePaymentAttemptId: null,
    status: "pending_payment",
    settlementState: "unsettled",
    probe: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    paymentCheckDueAt: new Date(now),
  };

  const seeds = [];
  seeds.push(ensureDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d01", { ...baseOrder, customerOpenId: "t0probe_openid_01" }));
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d02", {
      ...baseOrder,
      customerOpenId: "t0probe_openid_02",
      activePaymentAttemptId: "t0probe_attempt_d02_old",
    }),
  );
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d03", {
      ...baseOrder,
      customerOpenId: "t0probe_openid_03",
      activePaymentAttemptId: "t0probe_attempt_d03_b",
    }),
  );
  seeds.push(ensureDoc(ctx.db, COLLECTIONS.condUpdate, "t0probe_cond_default", { value: 0, version: 1, probe: true }));
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.leases, "t0probe_lease_default", {
      ownerId: "old-owner",
      leaseExpiresAt: new Date(now.getTime() - 60 * 1000),
      version: 1,
      lastHeartbeatAt: new Date(now.getTime() - 120 * 1000),
      probe: true,
    }),
  );

  const attemptBase = {
    orderId: null,
    paymentAttemptId: null,
    merchantOrderNo: null,
    channelStatus: "created",
    terminal: false,
    active: true,
    settlementState: "pending",
    settlementReviewState: "auto_retry",
    settlementNextRetryAt: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    probe: true,
  };
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d02_old", {
      ...attemptBase,
      orderId: "t0probe_order_d02",
      paymentAttemptId: "t0probe_attempt_d02_old",
      merchantOrderNo: "t0probe_mno_d02_old",
      active: true,
    }),
  );
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_a", {
      ...attemptBase,
      orderId: "t0probe_order_d03",
      paymentAttemptId: "t0probe_attempt_d03_a",
      merchantOrderNo: "t0probe_mno_d03_a",
      active: false,
      channelStatus: "user_paying",
    }),
  );
  seeds.push(
    ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_b", {
      ...attemptBase,
      orderId: "t0probe_order_d03",
      paymentAttemptId: "t0probe_attempt_d03_b",
      merchantOrderNo: "t0probe_mno_d03_b",
      active: true,
    }),
  );

  // [index, openId, status, expiresOffsetMin, paymentCheckOffsetMin]
  const orderSeedSpecs = [
    [0, "even", "pending_payment", 10, 5],
    [1, "odd", "pending_payment", -10, -5],
    [2, "even", "pending_payment", 40, -5],
    [3, "odd", "cancelled", 10, 5],
    [4, "even", "cancelled", 10, 5],
    [5, "even", "pending_payment", -10, 40],
  ];
  const orderSeeds = orderSeedSpecs.map(([index, parity, status, expiresOffsetMin, paymentCheckOffsetMin]) => ({
    _id: `t0probe_query_order_${index}`,
    customerOpenId: parity === "even" ? "t0probe_openid_even" : "t0probe_openid_odd",
    status,
    createdAt: new Date(now.getTime() + index * 60 * 1000),
    expiresAt: new Date(now.getTime() + expiresOffsetMin * 60 * 1000),
    paymentCheckDueAt: new Date(now.getTime() + paymentCheckOffsetMin * 60 * 1000),
    probe: true,
  }));
  for (const order of orderSeeds) {
    seeds.push(ensureDoc(ctx.db, COLLECTIONS.orders, order._id, order));
  }

  // [index, terminal, channelStatus, settlementState, reviewState, nextRetryOffsetMin]
  const attemptSeedSpecs = [
    [0, true, "success", "pending", "auto_retry", -3],
    [1, true, "success", "pending", "auto_retry", -2],
    [2, true, "success", "pending", "auto_retry", -1],
    [3, true, "success", "pending", "auto_retry", 1],
    [4, true, "success", "settled", "resolved", -4],
    [5, false, "created", "pending", "auto_retry", -5],
  ];
  const attemptSeeds = attemptSeedSpecs.map(([index, terminal, channelStatus, settlementState, reviewState, nextRetryOffsetMin]) => ({
    _id: `t0probe_query_attempt_${index}`,
    paymentAttemptId: `t0probe_query_attempt_${index}`,
    merchantOrderNo: `t0probe_query_mno_${index}`,
    terminal,
    channelStatus,
    settlementState,
    settlementReviewState: reviewState,
    settlementNextRetryAt: new Date(now.getTime() + nextRetryOffsetMin * 60 * 1000),
    orderId: `t0probe_query_order_${index}`,
    active: false,
    probe: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  }));
  for (const attempt of attemptSeeds) {
    seeds.push(ensureDoc(ctx.db, COLLECTIONS.attempts, attempt._id, attempt));
  }

  await Promise.all(seeds);
  return {
    collectionsCreated: created,
    collectionsAlreadyExisted: alreadyExisted,
    collectionsFailed: failed,
    seeded: orderSeeds.length + attemptSeeds.length + 5,
    pass: failed.length === 0,
  };
}

async function seedD01(ctx, key) {
  const orderId = `t0probe_order_${key}`;
  const existing = await readDoc(ctx.db, COLLECTIONS.orders, orderId);
  if (existing) return orderId;
  const now = new Date();
  await ensureDoc(ctx.db, COLLECTIONS.orders, orderId, {
    version: 1,
    activePaymentAttemptId: null,
    status: "pending_payment",
    settlementState: "unsettled",
    customerOpenId: `t0probe_openid_${key}`,
    probe: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
  });
  return orderId;
}

async function armBarrier(ctx, event) {
  const key = String(event.key);
  const participants = Number(event.participants);
  const leadMs = Number(event.leadMs);
  const barrierId = `t0probe_barrier_${key}-claim`;
  const orderId = await seedD01(ctx, key);
  const now = new Date();
  const payload = {
    key,
    participants,
    arrived: 0,
    startAfter: new Date(now.getTime() + leadMs),
    state: "armed",
    createdAt: new Date(now),
    probe: true,
  };

  try {
    await ctx.db.collection(COLLECTIONS.barriers).add({ data: { _id: barrierId, ...payload } });
    const barrier = await readDoc(ctx.db, COLLECTIONS.barriers, barrierId);
    return {
      ok: true,
      barrierId,
      orderId,
      barrier: docSummary(barrier, ["key", "participants", "arrived", "startAfter", "state"]),
      note: "barrier 已原子创建并提前准备；请在 startAfter 前并发调用两个 d01 请求。",
    };
  } catch (error) {
    const existing = await readDoc(ctx.db, COLLECTIONS.barriers, barrierId);
    if (existing) {
      return {
        ok: false,
        code: "BARRIER_ALREADY_EXISTS",
        barrierId,
        existing: docSummary(existing, ["key", "participants", "arrived", "startAfter", "state"]),
      };
    }
    return {
      ok: false,
      code: "BARRIER_CREATE_FAILED",
      barrierId,
      error: runtime.normalizeError(error),
    };
  }
}

async function waitAtBarrier(ctx, name, participants, caller) {
  const barrierId = `t0probe_barrier_${name}`;
  const arrivalId = `${barrierId}_arrival_${caller}`;
  const now = Date.now();
  const timeoutMs = 15000;
  let registration;
  try {
    registration = await ctx.db.runTransaction(async (tx) => {
      const barrierRead = await txDocGet(tx, COLLECTIONS.barriers, barrierId);
      const barrier = barrierRead.data;
      if (!barrier || barrier.state !== "armed") {
        return { accepted: false, reason: "barrier-not-armed", barrier: null };
      }
      if (Number(barrier.participants) !== Number(participants)) {
        return { accepted: false, reason: "participants-mismatch", barrier: docSummary(barrier, ["participants", "state"]) };
      }
      if (!dateMs(barrier.startAfter, 0)) {
        return { accepted: false, reason: "invalid-startAfter", barrier: docSummary(barrier, ["startAfter", "state"]) };
      }
      const arrivalRead = await txDocGet(tx, COLLECTIONS.barriers, arrivalId);
      if (arrivalRead.data) {
        return { accepted: false, reason: "duplicate-caller", barrier: docSummary(barrier, ["participants", "arrived", "state"]) };
      }
      await txDocSet(tx, COLLECTIONS.barriers, arrivalId, {
        kind: "arrival",
        barrierId,
        caller,
        probe: true,
        createdAt: ctx.db.serverDate(),
      });
      const updated = await txDocUpdate(tx, COLLECTIONS.barriers, barrierId, {
        arrived: ctx._.inc(1),
        updatedAt: ctx.db.serverDate(),
      });
      return { accepted: true, caller, arrivalId, updated: updated.stats.updated };
    });
  } catch (error) {
    return { ready: false, reason: "barrier-registration-failed", barrierId, arrivalId, error: runtime.normalizeError(error) };
  }
  if (!registration.accepted) {
    return { ready: false, reason: registration.reason, barrierId, arrivalId, barrier: registration.barrier || null };
  }

  const deadline = Date.now() + timeoutMs;
  let latest = await readDoc(ctx.db, COLLECTIONS.barriers, barrierId);
  while (Date.now() < deadline) {
    latest = await readDoc(ctx.db, COLLECTIONS.barriers, barrierId);
    if (Number(latest.arrived) >= Number(latest.participants) && Date.now() >= dateMs(latest.startAfter, 0)) {
      return {
        ready: true,
        barrierId,
        participants: latest.participants,
        arrived: latest.arrived,
        uniqueArrivals: latest.arrived,
        caller,
        arrivalId,
        startAfter: latest.startAfter,
        waitedMs: Date.now() - now,
      };
    }
    await runtime.sleep(100);
  }
  return {
    ready: false,
    reason: "barrier-timeout",
    barrierId,
    participants: latest ? latest.participants : null,
    arrived: latest ? latest.arrived : null,
    startAfter: latest ? latest.startAfter : null,
    waitedMs: Date.now() - now,
    timedOut: true,
  };
}

async function performClaim(ctx, key, caller, method) {
  const orderId = `t0probe_order_${key}`;
  const candidateId = `t0probe_attempt_${key}_${caller}`;
  let callbackRuns = 0;
  const readLog = [];
  let updateResult = null;
  let setResult = null;

  try {
    const transactionResult = await ctx.db.runTransaction(async (tx) => {
      callbackRuns += 1;
      updateResult = null;
      setResult = null;
      const orderRead = await txDocGet(tx, COLLECTIONS.orders, orderId);
      readLog.push({ step: "read-order", requestId: orderRead.requestId });
      const order = orderRead.data;
      if (!order) throw new Error("D01 order not found; run setup or seedD01 first");

      let activeAttempt = null;
      if (order.activePaymentAttemptId) {
        const attemptRead = await txDocGet(tx, COLLECTIONS.attempts, order.activePaymentAttemptId);
        readLog.push({ step: "read-active-attempt", requestId: attemptRead.requestId });
        activeAttempt = attemptRead.data;
      }

      const activeIsReusable =
        activeAttempt &&
        activeAttempt.terminal !== true &&
        dateMs(activeAttempt.expiresAt, 0) > Date.now();
      if (activeIsReusable) {
        return {
          outcome: "reused",
          candidateId,
          orderId,
          activePaymentAttemptId: order.activePaymentAttemptId,
          callbackRuns,
        };
      }

      if (activeAttempt) {
        const deactivate = await txDocUpdate(tx, COLLECTIONS.attempts, order.activePaymentAttemptId, {
          active: false,
          slotClosedAt: ctx.db.serverDate(),
          updatedAt: ctx.db.serverDate(),
        });
        readLog.push({ step: "deactivate-old-attempt", requestId: deactivate.requestId || null });
      }

      updateResult = await txVersionUpdate(
        tx,
        COLLECTIONS.orders,
        orderId,
        order.version,
        {
          activePaymentAttemptId: candidateId,
          version: ctx._.inc(1),
          updatedAt: ctx.db.serverDate(),
        },
        method,
      );
      readLog.push({ step: "conditional-order-update", requestId: updateResult.requestId, method: updateResult.method, updated: updateResult.updated });
      if (updateResult.updated !== 1) {
        throw runtime.transactionConflict("D01 conditional order update updated=0");
      }

      const attempt = {
        paymentAttemptId: candidateId,
        orderId,
        merchantOrderNo: `t0probe_mno_${key}_${caller}`,
        caller,
        channelStatus: "created",
        terminal: false,
        active: true,
        settlementState: "pending",
        settlementReviewState: "auto_retry",
        settlementNextRetryAt: null,
        createdAt: ctx.db.serverDate(),
        updatedAt: ctx.db.serverDate(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        probe: true,
      };
      setResult = await txDocSet(tx, COLLECTIONS.attempts, candidateId, attempt);
      readLog.push({ step: "create-attempt", requestId: setResult.requestId || null });

      return {
        outcome: "claimed",
        candidateId,
        orderId,
        activePaymentAttemptId: candidateId,
        callbackRuns,
      };
    });

    const orderAfter = await readDoc(ctx.db, COLLECTIONS.orders, orderId);
    const activeAfter = orderAfter && orderAfter.activePaymentAttemptId
      ? await readDoc(ctx.db, COLLECTIONS.attempts, orderAfter.activePaymentAttemptId)
      : null;
    return {
      status: "fulfilled",
      caller,
      method,
      candidateId,
      transactionResult,
      callbackRuns,
      orderAfter: docSummary(orderAfter, ["_id", "version", "activePaymentAttemptId", "status"]),
      activeAttemptAfter: docSummary(activeAfter, ["_id", "paymentAttemptId", "merchantOrderNo", "active", "terminal", "channelStatus", "caller"]),
      requestIds: requestIdsFrom(readLog),
      updateResult,
    };
  } catch (error) {
    return {
      status: "rejected",
      caller,
      method,
      candidateId,
      callbackRuns,
      error: runtime.normalizeError(error),
      requestIds: requestIdsFrom(readLog),
      updateResult,
      readLog,
    };
  }
}

function isRetryableClaimError(error) {
  const normalized = error || {};
  const text = `${normalized.code || ""} ${normalized.errCode || ""} ${normalized.errMsg || ""} ${normalized.message || ""}`;
  return /DATABASE_TRANSACTION_CONFLICT|TRANSACTION_CONFLICT|transaction conflict/i.test(text);
}

async function claimSlotOnce(ctx, key, caller, method, maxRetries) {
  const attempts = [];
  let last = null;
  for (let attemptNumber = 1; attemptNumber <= maxRetries; attemptNumber += 1) {
    const attempt = await performClaim(ctx, key, caller, method);
    attempts.push({ attemptNumber, status: attempt.status, outcome: attempt.transactionResult && attempt.transactionResult.outcome, error: attempt.error });
    last = attempt;
    if (attempt.status === "fulfilled") {
      return { ...attempt, attempts, applicationRetries: attemptNumber - 1, gaveUp: false };
    }
    if (!isRetryableClaimError(attempt.error)) {
      return { ...attempt, attempts, applicationRetries: attemptNumber - 1, gaveUp: true };
    }
    if (attemptNumber < maxRetries) {
      await runtime.sleep(100 * attemptNumber);
    }
  }
  return { ...last, attempts, applicationRetries: maxRetries - 1, gaveUp: true };
}

async function verifyD01State(ctx, key) {
  const orderId = `t0probe_order_${key}`;
  const order = await readDoc(ctx.db, COLLECTIONS.orders, orderId);
  const attemptResult = await ctx.db.collection(COLLECTIONS.attempts).where({ orderId }).limit(100).get();
  const attempts = attemptResult.data || [];
  const activeAttempts = attempts.filter((attempt) => attempt.active === true);
  const activeMerchantOrderNos = [...new Set(activeAttempts.map((attempt) => attempt.merchantOrderNo).filter(Boolean))];
  const activePaymentAttemptIds = activeAttempts.map((attempt) => attempt.paymentAttemptId).filter(Boolean);
  const barrier = await readDoc(ctx.db, COLLECTIONS.barriers, `t0probe_barrier_${key}-claim`);
  const concurrencyPass = Boolean(
    barrier &&
      Number(barrier.participants) >= 2 &&
      Number(barrier.arrived) >= Number(barrier.participants),
  );
  const statePass = Boolean(
    order &&
      order.activePaymentAttemptId &&
      activeAttempts.length === 1 &&
      activeMerchantOrderNos.length === 1 &&
      activePaymentAttemptIds.length === 1 &&
      activePaymentAttemptIds[0] === order.activePaymentAttemptId &&
      activeAttempts[0].terminal === false
  );
  return {
    orderId,
    order: docSummary(order, ["_id", "version", "activePaymentAttemptId", "status"]),
    attemptCount: attempts.length,
    activeAttemptCount: activeAttempts.length,
    activeMerchantOrderNos,
    activePaymentAttemptIds,
    barrier: docSummary(barrier, ["_id", "participants", "arrived", "startAfter", "state"]),
    statePass,
    concurrencyPass,
    pass: statePass && concurrencyPass,
  };
}

async function runD01(ctx, event) {
  const key = String(event.key || "d01");
  const method = transactionPath(event.method);
  const participants = Number(event.participants || 1);
  const caller = String(event.caller || "A");
  const maxRetries = Number(event.maxRetries || 5);
  const barrier = await waitAtBarrier(ctx, `${key}-claim`, participants, caller);
  if (!barrier.ready) {
    return {
      orderId: `t0probe_order_${key}`,
      caller,
      participants,
      method,
      barrier,
      claim: null,
      verification: null,
      pass: false,
      note: "barrier 未提前准备或已超时；请先运行 barrier action 再并发调用 d01。",
    };
  }

  const orderId = `t0probe_order_${key}`;
  const preparedOrder = await readDoc(ctx.db, COLLECTIONS.orders, orderId);
  if (!preparedOrder) {
    return { orderId, caller, participants, method, barrier, pass: false, formalPass: false, note: "barrier 已释放，但预置订单缺失；D01 不在并发窗口内创建或重置订单。" };
  }
  const claim = await claimSlotOnce(ctx, key, caller, method, maxRetries);
  const verification = await verifyD01State(ctx, key);
  const formalPass = evaluateD01FormalPass({ participants, claim, verification, method });
  return {
    orderId,
    caller,
    participants,
    method,
    maxRetries,
    barrier,
    claim,
    verification,
    formalPass,
    diagnosticPass: claim.status === "fulfilled" && verification.statePass,
    pass: formalPass,
    note: participants > 1
      ? "并发证据需不同 caller 的 d01 调用各自返回 fulfilled，并共同通过 d01_verify；raw-diagnostic 仅诊断，不构成正式 T0-D01 通过。"
      : "participants=1 仅用于单请求冒烟，不构成 T0-D01 并发证据。",
  };
}

async function runD01Verify(ctx, event) {
  const key = String(event.key);
  const verification = await verifyD01State(ctx, key);
  return { key, ...verification, pass: verification.pass };
}

async function seedD02(ctx) {
  const now = new Date();
  const previousNewAttempt = await readDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d02_new");
  if (previousNewAttempt) {
    await ctx.db.collection(COLLECTIONS.attempts).doc("t0probe_attempt_d02_new").remove();
  }
  await ensureDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d02", {
    version: 1,
    activePaymentAttemptId: "t0probe_attempt_d02_old",
    status: "pending_payment",
    settlementState: "unsettled",
    customerOpenId: "t0probe_openid_02",
    probe: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
  });
  await ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d02_old", {
    paymentAttemptId: "t0probe_attempt_d02_old",
    merchantOrderNo: "t0probe_mno_d02_old",
    orderId: "t0probe_order_d02",
    channelStatus: "created",
    terminal: false,
    active: true,
    settlementState: "pending",
    settlementReviewState: "auto_retry",
    settlementNextRetryAt: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    probe: true,
  });
}

async function runD02(ctx, event) {
  await seedD02(ctx);
  const method = transactionPath(event.method);
  const shouldRollback = event.rollback === true;
  const newAttemptId = "t0probe_attempt_d02_new";
  const readLog = [];
  let callbackRuns = 0;
  let transactionError = null;
  let updateResult = null;

  try {
    await ctx.db.runTransaction(async (tx) => {
      callbackRuns += 1;
      const orderRead = await txDocGet(tx, COLLECTIONS.orders, "t0probe_order_d02");
      readLog.push({ step: "read-order", requestId: orderRead.requestId });
      const order = orderRead.data;
      if (!order) throw new Error("D02 order not found");

      const oldRead = await txDocGet(tx, COLLECTIONS.attempts, "t0probe_attempt_d02_old");
      readLog.push({ step: "read-old-attempt", requestId: oldRead.requestId });
      if (!oldRead.data) throw new Error("D02 old attempt not found");

      const oldUpdate = await txDocUpdate(tx, COLLECTIONS.attempts, "t0probe_attempt_d02_old", {
        active: false,
        terminal: true,
        channelStatus: "closed",
        slotClosedAt: ctx.db.serverDate(),
        updatedAt: ctx.db.serverDate(),
      });
      readLog.push({ step: "invalidate-old-attempt", requestId: oldUpdate.requestId || null });

      const newAttempt = {
        paymentAttemptId: newAttemptId,
        merchantOrderNo: "t0probe_mno_d02_new",
        orderId: "t0probe_order_d02",
        channelStatus: "created",
        terminal: false,
        active: true,
        settlementState: "pending",
        settlementReviewState: "auto_retry",
        settlementNextRetryAt: null,
        createdAt: ctx.db.serverDate(),
        updatedAt: ctx.db.serverDate(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        probe: true,
      };
      const newSet = await txDocSet(tx, COLLECTIONS.attempts, newAttemptId, newAttempt);
      readLog.push({ step: "create-new-attempt", requestId: newSet.requestId || null });

      updateResult = await txVersionUpdate(
        tx,
        COLLECTIONS.orders,
        "t0probe_order_d02",
        order.version,
        {
          activePaymentAttemptId: newAttemptId,
          version: ctx._.inc(1),
          updatedAt: ctx.db.serverDate(),
        },
        method,
      );
      readLog.push({ step: "conditional-order-update", requestId: updateResult.requestId, method: updateResult.method, updated: updateResult.updated });
      if (updateResult.updated !== 1) {
        throw runtime.transactionConflict("D02 conditional order update updated=0");
      }

      if (shouldRollback) {
        throw runtime.forcedRollback("T0-D02 forced rollback");
      }
    });
  } catch (error) {
    transactionError = runtime.normalizeError(error);
  }

  const orderAfter = await readDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d02");
  const oldAfter = await readDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d02_old");
  const newAfter = await readDoc(ctx.db, COLLECTIONS.attempts, newAttemptId);
  const committed = !shouldRollback && !transactionError;
  const normalPass = Boolean(
    committed && orderAfter && orderAfter.activePaymentAttemptId === newAttemptId && oldAfter && oldAfter.active === false && oldAfter.terminal === true && newAfter && newAfter.active === true,
  );
  const rollbackClean = Boolean(
    shouldRollback &&
      transactionError &&
      transactionError.code === "T0_FORCED_ROLLBACK" &&
      orderAfter &&
      orderAfter.version === 1 &&
      orderAfter.activePaymentAttemptId === "t0probe_attempt_d02_old" &&
      oldAfter &&
      oldAfter.active === true &&
      oldAfter.terminal === false &&
      newAfter === null,
  );
  return {
    requestedRollback: shouldRollback,
    committed,
    method,
    callbackRuns,
    transactionError,
    updateResult,
    after: {
      order: docSummary(orderAfter, ["_id", "version", "activePaymentAttemptId", "status"]),
      oldAttempt: docSummary(oldAfter, ["_id", "paymentAttemptId", "active", "terminal", "channelStatus", "slotClosedAt"]),
      newAttempt: docSummary(newAfter, ["_id", "paymentAttemptId", "active", "terminal", "channelStatus"]),
    },
    rollbackClean,
    requestIds: requestIdsFrom(readLog),
    diagnosticPass: shouldRollback ? rollbackClean : normalPass,
    pass: method === "official-doc" && (shouldRollback ? rollbackClean : normalPass),
  };
}

async function seedD03(ctx) {
  const now = new Date();
  await ensureDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d03", {
    version: 1,
    activePaymentAttemptId: "t0probe_attempt_d03_b",
    status: "pending_payment",
    settlementState: "unsettled",
    customerOpenId: "t0probe_openid_03",
    probe: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
  });
  const baseAttempt = {
    orderId: "t0probe_order_d03",
    settlementState: "pending",
    settlementReviewState: "auto_retry",
    settlementNextRetryAt: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    probe: true,
  };
  await ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_a", {
    ...baseAttempt,
    paymentAttemptId: "t0probe_attempt_d03_a",
    merchantOrderNo: "t0probe_mno_d03_a",
    channelStatus: "user_paying",
    terminal: false,
    active: false,
  });
  await ensureDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_b", {
    ...baseAttempt,
    paymentAttemptId: "t0probe_attempt_d03_b",
    merchantOrderNo: "t0probe_mno_d03_b",
    channelStatus: "created",
    terminal: false,
    active: true,
  });
}

async function runD03(ctx) {
  await seedD03(ctx);
  const readLog = [];
  let callbackRuns = 0;
  let terminalUpdate = null;
  let transactionError = null;

  try {
    await ctx.db.runTransaction(async (tx) => {
      callbackRuns += 1;
      const orderRead = await txDocGet(tx, COLLECTIONS.orders, "t0probe_order_d03");
      readLog.push({ step: "read-order", requestId: orderRead.requestId });
      const order = orderRead.data;
      if (!order) throw new Error("D03 order not found");

      const attemptRead = await txDocGet(tx, COLLECTIONS.attempts, "t0probe_attempt_d03_a");
      readLog.push({ step: "read-inactive-attempt", requestId: attemptRead.requestId });
      const attempt = attemptRead.data;
      if (!attempt) throw new Error("D03 inactive attempt not found");

      terminalUpdate = await txDocUpdate(tx, COLLECTIONS.attempts, "t0probe_attempt_d03_a", {
        channelStatus: "success",
        terminal: true,
        active: false,
        callbackAt: ctx.db.serverDate(),
        updatedAt: ctx.db.serverDate(),
      });
      readLog.push({ step: "late-terminal-write-by-pk", requestId: terminalUpdate.requestId || null });

      if (order.activePaymentAttemptId === attempt.paymentAttemptId) {
        const clearSlot = await txVersionUpdate(
          tx,
          COLLECTIONS.orders,
          "t0probe_order_d03",
          order.version,
          { activePaymentAttemptId: null, version: ctx._.inc(1), updatedAt: ctx.db.serverDate() },
          "official-doc",
        );
        readLog.push({ step: "conditional-slot-clear", requestId: clearSlot.requestId, method: clearSlot.method, updated: clearSlot.updated });
      } else {
        readLog.push({ step: "conditional-slot-clear", skipped: "active slot belongs to another attempt" });
      }
    });
  } catch (error) {
    transactionError = runtime.normalizeError(error);
  }

  const orderAfter = await readDoc(ctx.db, COLLECTIONS.orders, "t0probe_order_d03");
  const attemptAAfter = await readDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_a");
  const attemptBAfter = await readDoc(ctx.db, COLLECTIONS.attempts, "t0probe_attempt_d03_b");
  return {
    callbackRuns,
    transactionError,
    terminalUpdate,
    after: {
      order: docSummary(orderAfter, ["_id", "version", "activePaymentAttemptId", "status"]),
      attemptA: docSummary(attemptAAfter, ["_id", "paymentAttemptId", "active", "terminal", "channelStatus", "callbackAt"]),
      attemptB: docSummary(attemptBAfter, ["_id", "paymentAttemptId", "active", "terminal", "channelStatus"]),
    },
    requestIds: requestIdsFrom(readLog),
    pass:
      !transactionError &&
      attemptAAfter &&
      attemptAAfter.terminal === true &&
      attemptAAfter.channelStatus === "success" &&
      orderAfter &&
      orderAfter.activePaymentAttemptId === "t0probe_attempt_d03_b",
  };
}

async function resetCondDoc(ctx, docId) {
  await ensureDoc(ctx.db, COLLECTIONS.condUpdate, docId, {
    value: 0,
    version: 1,
    probe: true,
    updatedAt: ctx.db.serverDate(),
  });
}

async function directConditionalIncrement(ctx, docId) {
  const read = await ctx.db.collection(COLLECTIONS.condUpdate).doc(docId).get();
  const readVersion = read && read.data ? read.data.version : null;
  if (!readVersion) throw new Error(`conditional doc not found: ${docId}`);
  const startedAt = Date.now();
  const update = await ctx.db.collection(COLLECTIONS.condUpdate).where({ _id: docId, version: readVersion }).update({
    data: {
      value: ctx._.inc(1),
      version: ctx._.inc(1),
      updatedAt: ctx.db.serverDate(),
    },
  });
  return {
    readVersion,
    updated: update.stats.updated,
    elapsedMs: Date.now() - startedAt,
  };
}

async function transactionConditionalIncrement(ctx, docId, method) {
  let callbackRuns = 0;
  const readLog = [];
  const transactionResult = await ctx.db.runTransaction(async (tx) => {
    callbackRuns += 1;
    const read = await txDocGet(tx, COLLECTIONS.condUpdate, docId);
    readLog.push({ step: "read", requestId: read.requestId, version: read.data && read.data.version });
    const result = await txVersionUpdate(
      tx,
      COLLECTIONS.condUpdate,
      docId,
      read.data.version,
      { value: ctx._.inc(1), version: ctx._.inc(1), updatedAt: ctx.db.serverDate() },
      method,
    );
    readLog.push({ step: "conditional-update", requestId: result.requestId, method: result.method, updated: result.updated });
    if (result.updated !== 1) {
      throw runtime.transactionConflict("D04 transaction conditional update updated=0");
    }
    return result;
  });
  return { status: "fulfilled", callbackRuns, transactionResult, requestIds: requestIdsFrom(readLog) };
}

async function runD04(ctx, event) {
  const docId = "t0probe_cond_default";
  await resetCondDoc(ctx, docId);
  const mode = event.mode === "transaction" ? "transaction" : "direct";
  const method = transactionPath(event.method);

  let races = null;
  if (mode === "direct") {
    const results = await Promise.all([directConditionalIncrement(ctx, docId), directConditionalIncrement(ctx, docId)]);
    races = { mode: "direct", results };
  } else {
    const settled = await runtime.allSettled([
      transactionConditionalIncrement(ctx, docId, method),
      transactionConditionalIncrement(ctx, docId, method),
    ]);
    races = { mode: "transaction", method, settled };
  }

  const after = await readDoc(ctx.db, COLLECTIONS.condUpdate, docId);
  const updatedCounts = mode === "direct"
    ? races.results.map((item) => item.updated).sort((a, b) => a - b)
    : races.settled
        .filter((item) => item.status === "fulfilled")
        .map((item) => item.value && item.value.transactionResult && item.value.transactionResult.updated)
        .sort((a, b) => a - b);
  const directPass = updatedCounts.length === 2 && updatedCounts[0] === 0 && updatedCounts[1] === 1 && after && after.value === 1 && after.version === 2;
  const transactionPass = Boolean(
    mode === "transaction" &&
      races.settled.length === 2 &&
      races.settled.every((item) => item.status === "fulfilled") &&
      races.settled.every((item) => item.value && item.value.transactionResult && item.value.transactionResult.updated === 1) &&
      after &&
      after.value === 2 &&
      after.version === 3,
  );

  return {
    docId,
    mode,
    method: mode === "direct" ? "direct-query-update" : method,
    races,
    after: docSummary(after, ["_id", "value", "version"]),
    updatedCounts,
    diagnosticPass: mode === "direct" ? directPass : transactionPass,
    pass: mode === "direct" ? directPass : method === "official-doc" && transactionPass,
  };
}

async function createUniqueAttempt(ctx, merchantOrderNo, label) {
  return ctx.db.runTransaction(async (tx) => {
    return tx.collection(COLLECTIONS.uniqueConflict).add({
      data: {
        merchantOrderNo,
        label,
        createdAt: ctx.db.serverDate(),
        updatedAt: ctx.db.serverDate(),
        probe: true,
      },
    });
  });
}

function uniqueConflictEvidence(error) {
  if (!error) return null;
  const text = `${error.code || ""} ${error.errCode || ""} ${error.errMsg || ""} ${error.message || ""}`;
  const mentionsUniqueField = /merchantOrderNo/i.test(text);
  const duplicateSignal = /duplicate|E11000|unique constraint|唯一|已存在|already exists/i.test(text);
  return {
    code: error.code || null,
    errCode: error.errCode || null,
    errMsg: error.errMsg || null,
    message: error.message || null,
    mentionsUniqueField,
    duplicateSignal,
    confirmedUniqueIndexConflict: mentionsUniqueField && duplicateSignal,
  };
}

async function runD05(ctx, event) {
  const runId = event.runId ? String(event.runId).slice(0, 24) : `${Date.now()}`;
  const seqKey = `t0probe_seq_${runId}`;
  const retryKey = `t0probe_seq_retry_${runId}`;
  const concurrentKey = `t0probe_concurrent_${runId}`;
  const concurrentRetryKey = `t0probe_concurrent_retry_${runId}`;

  const sequential = {};
  try {
    sequential.first = await createUniqueAttempt(ctx, seqKey, "first");
  } catch (error) {
    sequential.firstError = runtime.normalizeError(error);
  }
  try {
    sequential.duplicate = await createUniqueAttempt(ctx, seqKey, "duplicate-should-fail");
    sequential.duplicateUnexpectedlySucceeded = true;
  } catch (error) {
    sequential.duplicateError = runtime.normalizeError(error);
    sequential.duplicateUniqueConflict = uniqueConflictEvidence(sequential.duplicateError);
  }
  try {
    sequential.retry = await createUniqueAttempt(ctx, retryKey, "retry-after-duplicate");
  } catch (error) {
    sequential.retryError = runtime.normalizeError(error);
  }

  const concurrent = {};
  const concurrentResults = await runtime.allSettled([
    createUniqueAttempt(ctx, concurrentKey, "concurrent-a"),
    createUniqueAttempt(ctx, concurrentKey, "concurrent-b"),
  ]);
  concurrent.results = concurrentResults;
  concurrent.fulfilled = concurrentResults.filter((item) => item.status === "fulfilled").length;
  concurrent.rejected = concurrentResults.filter((item) => item.status === "rejected").length;
  const concurrentRejectedConflict = concurrentResults
    .filter((item) => item.status === "rejected")
    .map((item) => uniqueConflictEvidence(item.reason));
  concurrent.rejectedConflictEvidence = concurrentRejectedConflict;
  try {
    concurrent.retry = await createUniqueAttempt(ctx, concurrentRetryKey, "retry-after-concurrent-conflict");
  } catch (error) {
    concurrent.retryError = runtime.normalizeError(error);
  }

  return {
    runId,
    indexRequired: "t0probe_unique_conflict.merchantOrderNo UNIQUE",
    sequential,
    concurrent,
    pass:
      Boolean(sequential.first) &&
      Boolean(sequential.duplicateError) &&
      Boolean(sequential.duplicateUniqueConflict && sequential.duplicateUniqueConflict.confirmedUniqueIndexConflict) &&
      Boolean(sequential.retry) &&
      concurrent.fulfilled === 1 &&
      concurrentRejectedConflict.length === 1 &&
      Boolean(concurrentRejectedConflict[0] && concurrentRejectedConflict[0].confirmedUniqueIndexConflict) &&
      Boolean(concurrent.retry),
  };
}

async function writeTxBatch(ctx, count) {
  const startedAt = Date.now();
  try {
    await ctx.db.runTransaction(async (tx) => {
      for (let index = 0; index < count; index += 1) {
        await txDocSet(tx, COLLECTIONS.txLimit, `t0probe_tx_slot_${index}`, {
          slot: index,
          batch: "write",
          value: 1,
          updatedAt: ctx.db.serverDate(),
          probe: true,
        });
      }
    });
    return { ok: true, count, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, count, elapsedMs: Date.now() - startedAt, error: runtime.normalizeError(error) };
  }
}

async function readTxBatch(ctx, count) {
  const startedAt = Date.now();
  const readLog = [];
  try {
    await ctx.db.runTransaction(async (tx) => {
      for (let index = 0; index < count; index += 1) {
        const read = await txDocGet(tx, COLLECTIONS.txLimit, `t0probe_tx_slot_${index}`);
        readLog.push({ index, found: Boolean(read.data), requestId: read.requestId });
      }
    });
    return { ok: true, count, found: readLog.filter((item) => item.found).length, missing: readLog.filter((item) => !item.found).length, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, count, found: readLog.filter((item) => item.found).length, missing: readLog.filter((item) => !item.found).length, elapsedMs: Date.now() - startedAt, error: runtime.normalizeError(error) };
  }
}

async function binarySearchLimit(test, maxSearch) {
  const log = [];
  const initial = await test(1);
  log.push({ tested: 1, ok: initial.ok, elapsedMs: initial.elapsedMs, missing: initial.missing || 0, error: initial.error || null });
  if (!initial.ok) {
    return { maxKnown: 0, searchCappedAt: false, edge: initial, log };
  }

  let low = 1;
  let high = maxSearch;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const result = await test(middle);
    log.push({ tested: middle, ok: result.ok, elapsedMs: result.elapsedMs, missing: result.missing || 0, error: result.error || null });
    if (result.ok) low = middle;
    else high = middle - 1;
  }
  const maxKnown = low;
  let edge = null;
  if (maxKnown < maxSearch) {
    edge = await test(maxKnown + 1);
    log.push({ tested: maxKnown + 1, ok: edge.ok, elapsedMs: edge.elapsedMs, missing: edge.missing || 0, error: edge.error || null });
  }
  return {
    maxKnown,
    searchCappedAt: maxKnown >= maxSearch,
    edge,
    log,
  };
}

function evaluateD06Evidence({ seeding, writeBudget, readBudget, writeLimit, readLimit, budget }) {
  const readLogMissing = readLimit.log.reduce((sum, item) => sum + (item.missing || 0), 0);
  const writeBoundaryConfirmed = Boolean(writeLimit.edge && writeLimit.edge.ok === false);
  const readBoundaryConfirmed = Boolean(readLimit.edge && readLimit.edge.ok === false);
  const budgetPass = Boolean(
    seeding.ok &&
      writeBudget.ok &&
      readBudget.ok &&
      readBudget.missing === 0 &&
      writeLimit.maxKnown >= budget &&
      readLimit.maxKnown >= budget &&
      readLogMissing === 0,
  );
  const limitCharacterized = writeBoundaryConfirmed && readBoundaryConfirmed;
  return {
    budgetPass,
    limitCharacterized,
    writeBoundaryConfirmed,
    readBoundaryConfirmed,
    readLogMissing,
    pass: budgetPass && limitCharacterized,
  };
}


async function seedTxSlots(ctx, count) {
  const cleanup = await removeAllDocs(ctx.db, COLLECTIONS.txLimit);
  if (!cleanup.pass) {
    return { ok: false, cleanup, created: 0 };
  }
  let created = 0;
  const chunkSize = 50;
  try {
    for (let start = 0; start < count; start += chunkSize) {
      const docs = [];
      for (let index = start; index < Math.min(start + chunkSize, count); index += 1) {
        docs.push({
          _id: `t0probe_tx_slot_${index}`,
          slot: index,
          seed: true,
          value: 0,
          probe: true,
        });
      }
      await ctx.db.collection(COLLECTIONS.txLimit).add({ data: docs });
      created += docs.length;
    }
    return { ok: true, cleanup, created };
  } catch (error) {
    return { ok: false, cleanup, created, error: runtime.normalizeError(error) };
  }
}
async function runD06(ctx, event) {
  const maxSearch = Number(event.maxSearch || 256);
  const budget = Number(event.budget || 40);
  const seeding = await seedTxSlots(ctx, maxSearch);
  if (!seeding.ok) {
    return { budget, maxSearch, seeding, pass: false, note: "无法预置足量事务读测试文档，D06 中止。" };
  }
  const writeBudget = await writeTxBatch(ctx, budget);
  const readBudget = await readTxBatch(ctx, budget);
  const writeLimit = await binarySearchLimit((count) => writeTxBatch(ctx, count), maxSearch);
  const readLimit = await binarySearchLimit((count) => readTxBatch(ctx, count), maxSearch);
  const evidence = evaluateD06Evidence({ seeding, writeBudget, readBudget, writeLimit, readLimit, budget });
  return {
    budget,
    maxSearch,
    seeding,
    writeBudget,
    readBudget,
    writeLimit,
    readLimit,
    budgetPass: evidence.budgetPass,
    limitCharacterized: evidence.limitCharacterized,
    writeBoundaryConfirmed: evidence.writeBoundaryConfirmed,
    readBoundaryConfirmed: evidence.readBoundaryConfirmed,
    readLogMissing: evidence.readLogMissing,
    projectWriteBudget: 40,
    pass: evidence.pass,
    note: "budgetPass 证明项目预算可用；limitCharacterized 仅在读写均观察到首个失败边界时成立。searchCappedAt=true 表示尚未测明上限，不能计为边界确认。",
  };
}

async function runD07(ctx, event) {
  const marker = String(event.marker || `run_${Date.now()}`);
  const ids = [0, 1, 2].map((index) => `t0probe_serverdate_${marker}_${index}`);
  const multiId = `t0probe_serverdate_${marker}_multi`;
  const clientBefore = new Date();
  let callbackRuns = 0;
  let transactionError = null;
  let readLog = [];

  try {
    await ctx.db.runTransaction(async (tx) => {
      callbackRuns += 1;
      const timeA = ctx.db.serverDate();
      const timeB = ctx.db.serverDate();
      const timeC = ctx.db.serverDate();
      for (let index = 0; index < ids.length; index += 1) {
        const read = await txDocSet(tx, COLLECTIONS.serverDate, ids[index], {
          index,
          timeA,
          timeB,
          timeC,
          serverTime: index === 0 ? timeA : index === 1 ? timeB : timeC,
          updatedAt: ctx.db.serverDate(),
          probe: true,
        });
        readLog.push({ step: `set-${index}`, requestId: read.requestId || null });
      }
      const multi = await txDocSet(tx, COLLECTIONS.serverDate, multiId, {
        timeA,
        timeB,
        timeC,
        updatedAt: ctx.db.serverDate(),
        probe: true,
      });
      readLog.push({ step: "set-multi", requestId: multi.requestId || null });
    });
  } catch (error) {
    transactionError = runtime.normalizeError(error);
  }

  const clientAfter = new Date();
  const values = [];
  for (const id of ids.concat(multiId)) {
    const doc = await readDoc(ctx.db, COLLECTIONS.serverDate, id);
    if (doc) values.push({ id, timeA: doc.timeA, timeB: doc.timeB, timeC: doc.timeC, serverTime: doc.serverTime, updatedAt: doc.updatedAt });
  }

  const allTimes = [];
  for (const item of values) {
    for (const field of ["timeA", "timeB", "timeC", "serverTime", "updatedAt"]) {
      if (item[field]) allTimes.push(new Date(item[field]).getTime());
    }
  }
  const minTime = allTimes.length ? Math.min(...allTimes) : null;
  const maxTime = allTimes.length ? Math.max(...allTimes) : null;
  const distinct = new Set(allTimes).size;
  const allDatesValid = allTimes.every((value) => Number.isFinite(value));
  const allDocsPresent = values.length === ids.length + 1;
  const fieldsComplete = values.every((item) => ["timeA", "timeB", "timeC", "serverTime", "updatedAt"].every((field) => item[field] !== null && item[field] !== undefined));
  const withinWindow = allTimes.every((value) => value >= clientBefore.getTime() - 60 * 1000 && value <= clientAfter.getTime() + 60 * 1000);
  const maxDeltaMs = allTimes.length ? maxTime - minTime : null;
  return {
    marker,
    callbackRuns,
    transactionError,
    values,
    summary: {
      distinctTimestamps: distinct,
      maxDeltaMs,
      allDatesValid,
      allDocsPresent,
      fieldsComplete,
      clientBefore: clientBefore.toISOString(),
      clientAfter: clientAfter.toISOString(),
      allServerTimesWithinClientWindow: withinWindow,
    },
    requestIds: requestIdsFrom(readLog),
    pass: Boolean(
      !transactionError &&
        allDocsPresent &&
        fieldsComplete &&
        allDatesValid &&
        distinct > 0 &&
        maxDeltaMs !== null &&
        maxDeltaMs <= 2000 &&
        withinWindow,
    ),
  };
}

async function writeTimerMarker(ctx, event, runId) {
  const startedAt = Date.now();
  const result = await ctx.db.collection(COLLECTIONS.timerLog).add({
    data: {
      triggerName: event.TriggerName || event.triggerName || "manual-d08",
      triggerTime: event.Time || event.time || new Date().toISOString(),
      runId,
      probe: true,
      createdAt: ctx.db.serverDate(),
    },
  });
  return { markerId: result.id || result._id || null, requestId: result.requestId || null, elapsedMs: Date.now() - startedAt };
}

async function runD08(ctx, event, runId) {
  let marker = null;
  let markerError = null;
  try {
    marker = await writeTimerMarker(ctx, event, runId);
  } catch (error) {
    markerError = runtime.normalizeError(error);
  }
  let config = null;
  try {
    config = require("../config.json");
  } catch (error) {
    config = { error: runtime.normalizeError(error) };
  }
  const timerEvent = Boolean(event.TriggerName || event.triggerName || String(event.Type || event.type || "").toLowerCase() === "timer");
  return {
    timerEvent,
    mode: timerEvent ? "timer" : "manual-smoke",
    triggerConfig: config && config.triggers ? config.triggers : config,
    marker,
    markerError,
    pass: Boolean(timerEvent && marker && !markerError),
    note: timerEvent ? null : "手工调用只验证写入路径，不构成 T0-D08 定时触发器动态证据；必须等待真实 Timer 事件。",
  };
}

function leasePreconditionFailure(lease, expectedVersion, expectedOwnerId, requireExpired, nowMs) {
  if (!lease) return { reason: "not-found" };
  if (lease.version !== expectedVersion) {
    return { reason: "version-mismatch", observedVersion: lease.version };
  }
  if (expectedOwnerId && lease.ownerId !== expectedOwnerId) {
    return { reason: "owner-mismatch", observedOwnerId: lease.ownerId };
  }
  if (requireExpired && dateMs(lease.leaseExpiresAt, Number.POSITIVE_INFINITY) > nowMs) {
    return { reason: "lease-not-expired" };
  }
  return null;
}

async function acquireLease(ctx, docId, ownerId, expectedVersion, expectedOwnerId, requireExpired, method) {
  const now = new Date();
  const startedAt = Date.now();
  let result;
  if (method === "official-doc") {
    try {
      await ctx.db.runTransaction(async (tx) => {
        const txRead = await txDocGet(tx, COLLECTIONS.leases, docId);
        const lease = txRead.data;
        const preconditionFailure = leasePreconditionFailure(
          lease,
          expectedVersion,
          expectedOwnerId,
          requireExpired,
          now.getTime(),
        );
        if (preconditionFailure) {
          result = { mode: "official-doc", updated: 0, ...preconditionFailure };
          return;
        }
        const txResult = await txOfficialDocVersionUpdate(
          tx,
          COLLECTIONS.leases,
          docId,
          expectedVersion,
          {
            ownerId,
            leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
            version: ctx._.inc(1),
            lastHeartbeatAt: ctx.db.serverDate(),
          },
        );
        if (txResult.updated !== 1) throw runtime.transactionConflict("lease acquire updated=0");
        result = { mode: "official-doc", updated: txResult.updated, requestId: txResult.requestId };
      });
    } catch (error) {
      result = { mode: "official-doc", updated: 0, error: runtime.normalizeError(error) };
    }
  } else {
    const read = await ctx.db.collection(COLLECTIONS.leases).doc(docId).get();
    const lease = read && read.data;
    if (!lease) return { mode: "direct-query-update", updated: 0, reason: "not-found", elapsedMs: Date.now() - startedAt };
    const where = { _id: docId, version: expectedVersion };
    if (expectedOwnerId) where.ownerId = expectedOwnerId;
    if (requireExpired) where.leaseExpiresAt = ctx._.lte(now);
    const update = await ctx.db.collection(COLLECTIONS.leases).where(where).update({
      data: {
        ownerId,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        version: ctx._.inc(1),
        lastHeartbeatAt: ctx.db.serverDate(),
      },
    });
    result = { mode: "direct-query-update", updated: update.stats.updated };
  }
  return { ...result, elapsedMs: Date.now() - startedAt };
}

async function runD09(ctx, event) {
  const method = event.mode === "transaction" ? "official-doc" : "direct-query-update";
  const runId = String(event.runId || Date.now());
  const expiredDocId = `t0probe_lease_expired_${runId}`;
  const heldDocId = `t0probe_lease_held_${runId}`;
  const boundaryDocId = `t0probe_lease_boundary_${runId}`;
  const now = new Date();

  await ensureDoc(ctx.db, COLLECTIONS.leases, expiredDocId, {
    ownerId: "old-owner",
    leaseExpiresAt: new Date(now.getTime() - 60 * 1000),
    version: 1,
    lastHeartbeatAt: new Date(now.getTime() - 120 * 1000),
    probe: true,
  });
  await ensureDoc(ctx.db, COLLECTIONS.leases, heldDocId, {
    ownerId: "owner-a",
    leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    version: 1,
    lastHeartbeatAt: new Date(now),
    probe: true,
  });
  await ensureDoc(ctx.db, COLLECTIONS.leases, boundaryDocId, {
    ownerId: "owner-boundary-old",
    leaseExpiresAt: new Date(),
    version: 1,
    lastHeartbeatAt: new Date(now),
    probe: true,
  });

  const takeover = {};
  takeover.bAcquiresExpired = await acquireLease(ctx, expiredDocId, "owner-b", 1, null, true, method);
  takeover.oldOwnerRenewsAfterTakeover = await acquireLease(ctx, expiredDocId, "old-owner", 1, "old-owner", false, method);
  takeover.ownerBRenews = await acquireLease(ctx, expiredDocId, "owner-b", 2, "owner-b", false, method);

  const held = {};
  held.bTriesUnexpired = await acquireLease(ctx, heldDocId, "owner-b", 1, null, true, method);
  held.ownerARenews = await acquireLease(ctx, heldDocId, "owner-a", 1, "owner-a", false, method);
  held.ownerARenewsOldVersionAfterSuccess = await acquireLease(ctx, heldDocId, "owner-a", 1, "owner-a", false, method);

  const boundary = {};
  boundary.acquireAtBoundary = await acquireLease(ctx, boundaryDocId, "owner-boundary-new", 1, null, true, method);

  const expiredAfter = await readDoc(ctx.db, COLLECTIONS.leases, expiredDocId);
  const heldAfter = await readDoc(ctx.db, COLLECTIONS.leases, heldDocId);
  const boundaryAfter = await readDoc(ctx.db, COLLECTIONS.leases, boundaryDocId);
  const typeChecks = {
    expiredLeaseExpiresAtIsDate: isDateObject(expiredAfter && expiredAfter.leaseExpiresAt),
    expiredLeaseLastHeartbeatAtIsDate: isDateObject(expiredAfter && expiredAfter.lastHeartbeatAt),
    heldLeaseExpiresAtIsDate: isDateObject(heldAfter && heldAfter.leaseExpiresAt),
    heldLeaseLastHeartbeatAtIsDate: isDateObject(heldAfter && heldAfter.lastHeartbeatAt),
    boundaryLeaseExpiresAtIsDate: isDateObject(boundaryAfter && boundaryAfter.leaseExpiresAt),
  };
  const typeChecksPass = Object.values(typeChecks).every(Boolean);
  return {
    method,
    takeover,
    held,
    boundary,
    after: {
      expiredLease: docSummary(expiredAfter, ["_id", "ownerId", "version", "leaseExpiresAt", "lastHeartbeatAt"]),
      heldLease: docSummary(heldAfter, ["_id", "ownerId", "version", "leaseExpiresAt", "lastHeartbeatAt"]),
      boundaryLease: docSummary(boundaryAfter, ["_id", "ownerId", "version", "leaseExpiresAt", "lastHeartbeatAt"]),
    },
    typeChecks,
    diagnosticPass:
      takeover.bAcquiresExpired.updated === 1 &&
      takeover.oldOwnerRenewsAfterTakeover.updated === 0 &&
      takeover.ownerBRenews.updated === 1 &&
      held.bTriesUnexpired.updated === 0 &&
      held.ownerARenews.updated === 1 &&
      held.ownerARenewsOldVersionAfterSuccess.updated === 0 &&
      boundary.acquireAtBoundary.updated === 1 &&
      expiredAfter.ownerId === "owner-b" &&
      heldAfter.ownerId === "owner-a" &&
      boundaryAfter.ownerId === "owner-boundary-new" &&
      typeChecksPass,
    pass: method === "official-doc" && (
      takeover.bAcquiresExpired.updated === 1 &&
      takeover.oldOwnerRenewsAfterTakeover.updated === 0 &&
      takeover.ownerBRenews.updated === 1 &&
      held.bTriesUnexpired.updated === 0 &&
      held.ownerARenews.updated === 1 &&
      held.ownerARenewsOldVersionAfterSuccess.updated === 0 &&
      boundary.acquireAtBoundary.updated === 1 &&
      expiredAfter.ownerId === "owner-b" &&
      heldAfter.ownerId === "owner-a" &&
      boundaryAfter.ownerId === "owner-boundary-new" &&
      typeChecksPass
    ),
  };
}

async function timedQuery(label, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return { label, status: "fulfilled", elapsedMs: Date.now() - startedAt, result };
  } catch (error) {
    return { label, status: "rejected", elapsedMs: Date.now() - startedAt, error: runtime.normalizeError(error) };
  }
}

const D10_BASELINE_MS = Date.parse("2020-01-02T00:00:00.000Z");

async function seedD10(ctx) {
  const baseline = new Date(D10_BASELINE_MS);
  const orderSeedSpecs = [
    [0, "even", "pending_payment", 10, 5],
    [1, "odd", "pending_payment", -10, -5],
    [2, "even", "pending_payment", 40, -5],
    [3, "odd", "cancelled", 10, 5],
    [4, "even", "cancelled", 10, 5],
    [5, "even", "pending_payment", -10, 40],
  ];
  const attemptSeedSpecs = [
    [0, true, "success", "pending", "auto_retry", -3],
    [1, true, "success", "pending", "auto_retry", -2],
    [2, true, "success", "pending", "auto_retry", -1],
    [3, true, "success", "pending", "auto_retry", 1],
    [4, true, "success", "settled", "resolved", -4],
    [5, false, "created", "pending", "auto_retry", -5],
  ];
  const writes = [];
  for (const [index, parity, status, expiresOffsetMin, paymentCheckOffsetMin] of orderSeedSpecs) {
    writes.push(ensureDoc(ctx.db, COLLECTIONS.orders, `t0probe_query_order_${index}`, {
      customerOpenId: parity === "even" ? "t0probe_openid_even" : "t0probe_openid_odd",
      status,
      createdAt: new Date(D10_BASELINE_MS + index * 60 * 1000),
      expiresAt: new Date(D10_BASELINE_MS + expiresOffsetMin * 60 * 1000),
      paymentCheckDueAt: new Date(D10_BASELINE_MS + paymentCheckOffsetMin * 60 * 1000),
      probe: true,
    }));
  }
  for (const [index, terminal, channelStatus, settlementState, reviewState, nextRetryOffsetMin] of attemptSeedSpecs) {
    writes.push(ensureDoc(ctx.db, COLLECTIONS.attempts, `t0probe_query_attempt_${index}`, {
      paymentAttemptId: `t0probe_query_attempt_${index}`,
      merchantOrderNo: `t0probe_query_mno_${index}`,
      terminal,
      channelStatus,
      settlementState,
      settlementReviewState: reviewState,
      settlementNextRetryAt: new Date(D10_BASELINE_MS + nextRetryOffsetMin * 60 * 1000),
      orderId: `t0probe_query_order_${index}`,
      active: false,
      probe: true,
      createdAt: new Date(baseline),
      updatedAt: new Date(baseline),
    }));
  }
  await Promise.all(writes);
  return { baseline, orders: orderSeedSpecs.length, attempts: attemptSeedSpecs.length };
}

async function runD10(ctx) {
  const seeded = await seedD10(ctx);
  const baseline = seeded.baseline;
  const expected = {
    "orders(customerOpenId, status, createdAt, _id)": {
      count: 3,
      ids: ["t0probe_query_order_0", "t0probe_query_order_2", "t0probe_query_order_5"],
    },
    "orders(status, expiresAt, paymentCheckDueAt)": {
      count: 2,
      ids: ["t0probe_query_order_1", "t0probe_query_order_0"],
    },
    "payment_attempts(terminal, channelStatus, settlementState, settlementReviewState, settlementNextRetryAt)": {
      count: 3,
      ids: ["t0probe_query_attempt_0", "t0probe_query_attempt_1", "t0probe_query_attempt_2"],
    },
  };

  const queries = [];
  queries.push(
    timedQuery("orders(customerOpenId, status, createdAt, _id)", async () => {
      const result = await ctx.db.collection(COLLECTIONS.orders)
        .where({ customerOpenId: "t0probe_openid_even", status: "pending_payment" })
        .orderBy("createdAt", "asc")
        .orderBy("_id", "asc")
        .limit(50)
        .get();
      return { count: result.data.length, ids: result.data.map((doc) => doc._id) };
    }),
  );
  queries.push(
    timedQuery("orders(status, expiresAt, paymentCheckDueAt)", async () => {
      const result = await ctx.db.collection(COLLECTIONS.orders)
        .where({
          status: "pending_payment",
          expiresAt: ctx._.lte(new Date(baseline.getTime() + 30 * 60 * 1000)),
          paymentCheckDueAt: ctx._.lte(new Date(baseline.getTime() + 30 * 60 * 1000)),
        })
        .orderBy("expiresAt", "asc")
        .limit(50)
        .get();
      return { count: result.data.length, ids: result.data.map((doc) => doc._id) };
    }),
  );
  queries.push(
    timedQuery("payment_attempts(terminal, channelStatus, settlementState, settlementReviewState, settlementNextRetryAt)", async () => {
      const result = await ctx.db.collection(COLLECTIONS.attempts)
        .where({
          terminal: true,
          channelStatus: "success",
          settlementState: "pending",
          settlementReviewState: "auto_retry",
          settlementNextRetryAt: ctx._.lte(baseline),
        })
        .orderBy("settlementNextRetryAt", "asc")
        .limit(50)
        .get();
      return { count: result.data.length, ids: result.data.map((doc) => doc._id) };
    }),
  );

  const settled = await Promise.all(queries);
  const assertions = settled.map((item) => {
    const expectation = expected[item.label];
    const matches = item.status === "fulfilled" && expectation &&
      item.result.count === expectation.count &&
      item.result.ids.length === expectation.ids.length &&
      expectation.ids.every((id, index) => item.result.ids[index] === id);
    return { label: item.label, expected: expectation, actual: item.result || null, matches };
  });
  return {
    seed: { baseline: baseline.toISOString(), orders: seeded.orders, attempts: seeded.attempts },
    queries: settled,
    assertions,
    indexManifest: "t0-probe/indexes.json",
    note: "SDK 查询返回值不含 explain/query plan。请同时在微信云开发控制台对 indexes.json 中三条复合索引执行同条件查询并截图 EXPLAIN/查询计划作为 T0-D10 证据。",
    pass: assertions.length === Object.keys(expected).length && assertions.every((item) => item.matches),
  };
}

function httpProbe(url) {
  return new Promise((resolve) => {
    const transport = url.startsWith("https:") ? https : http;
    const startedAt = Date.now();
    const request = transport.get(url, { timeout: 2500 }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 4096) response.destroy();
      });
      response.on("end", () => {
        resolve({ url, statusCode: response.statusCode, bytes, elapsedMs: Date.now() - startedAt, error: null });
      });
      response.on("error", (error) => {
        resolve({ url, statusCode: response.statusCode, bytes, elapsedMs: Date.now() - startedAt, error: runtime.normalizeError(error) });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) => {
      resolve({ url, statusCode: null, bytes: 0, elapsedMs: Date.now() - startedAt, error: runtime.normalizeError(error) });
    });
  });
}

async function runD11() {
  const endpoints = [
    "http://metadata.tencentyun.com/latest/meta-data/instance-id",
    "http://metadata.tencentyun.com/latest/meta-data/placement/region",
    "https://api.weixin.qq.com/",
  ];
  const probes = [];
  for (const url of endpoints) {
    probes.push(await httpProbe(url));
  }
  const envKeys = Object.keys(process.env).sort();
  const vpcKeys = envKeys.filter((key) => /VPC|SCF|TCB|CLOUDBASE|TENCENT|WX_/i.test(key));
  return {
    endpointsFixed: endpoints,
    customEndpointsRejectedByGate: true,
    egressProbes: probes,
    envKeysTotal: envKeys.length,
    vpcOrPlatformKeys: vpcKeys,
    requiresConsoleEvidence: [
      "测试环境是否支持云函数 VPC 配置",
      "测试环境是否支持出口限制/安全组",
      "测试环境是否支持 WAF 或等效边界防护",
      "控制台截图/导出配置作为 T0-D11 证据，不在 SDK 内臆断",
    ],
    note: "环境变量只记录 key，不记录值；WAF/VPC/出口限制的可用性结论以控制台配置与安全审计记录为准。",
  };
}

function pollutionSignature() {
  return {
    objectProtoPolluted: {}.polluted === true,
    arrayProtoPolluted: [].polluted === true,
    objectConstructorPolluted: Object.prototype.polluted === true,
    pollutedObjectKeys: Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
  };
}

function defaultPollutionSamples() {
  return [
    { name: "__proto__-direct", json: "{\"__proto__\":{\"polluted\":true},\"safe\":\"ok\"}" },
    { name: "constructor-prototype", json: "{\"constructor\":{\"prototype\":{\"polluted\":true}},\"safe\":\"ok\"}" },
    { name: "nested-__proto__", json: "{\"meta\":{\"__proto__\":{\"polluted\":true}},\"safe\":\"ok\"}" },
    { name: "array-constructor", json: "{\"items\":[{\"constructor\":{\"prototype\":{\"polluted\":true}}}],\"safe\":\"ok\"}" },
    { name: "query-command-like", json: "{\"__proto__\":{\"polluted\":true},\"constructor\":{\"prototype\":{\"polluted\":true}},\"value\":{\"$gt\":1}}" },
  ];
}

async function runD12(ctx, event) {
  const before = pollutionSignature();
  const samples = Array.isArray(event.samples)
    ? event.samples
    : defaultPollutionSamples();
  const results = [];
  const marker = `t0probe_pollution_${Date.now()}`;

  for (const sample of samples) {
    const sampleJson = typeof sample === "string" ? sample : sample && typeof sample.json === "string" ? sample.json : JSON.stringify(sample);
    const sampleName = sample && typeof sample === "object" && sample.name ? sample.name : `sample_${results.length}`;
    const parsed = JSON.parse(sampleJson);
    const item = { name: sampleName, sampleJson: sampleJson.slice(0, 4000), operations: [] };
    const docId = `${marker}_${results.length}`;

    try {
      const addResult = await ctx.db.collection(COLLECTIONS.pollution).add({
        data: { _id: docId, marker, payload: parsed, probe: true, createdAt: ctx.db.serverDate() },
      });
      item.operations.push({ operation: "add", status: "fulfilled", result: addResult });
    } catch (error) {
      item.operations.push({ operation: "add", status: "rejected", error: runtime.normalizeError(error) });
    }

    try {
      const queryResult = await ctx.db.collection(COLLECTIONS.pollution).where({ marker }).limit(10).get();
      item.operations.push({ operation: "where-get", status: "fulfilled", count: queryResult.data.length });
    } catch (error) {
      item.operations.push({ operation: "where-get", status: "rejected", error: runtime.normalizeError(error) });
    }

    try {
      const updateResult = await ctx.db.collection(COLLECTIONS.pollution).doc(docId).update({
        data: { nested: parsed, marker, updatedAt: ctx.db.serverDate() },
      });
      item.operations.push({ operation: "doc-update-nested-merge", status: "fulfilled", updated: updateResult.stats.updated });
    } catch (error) {
      item.operations.push({ operation: "doc-update-nested-merge", status: "rejected", error: runtime.normalizeError(error) });
    }

    try {
      await ctx.db.runTransaction(async (tx) => {
        const read = await txDocGet(tx, COLLECTIONS.pollution, docId);
        const update = await txDocUpdate(tx, COLLECTIONS.pollution, docId, {
          txPayload: parsed,
          marker,
          updatedAt: ctx.db.serverDate(),
        });
        item.operations.push({ operation: "transaction-read-update", status: "fulfilled", found: Boolean(read.data), updated: update.stats.updated });
      });
    } catch (error) {
      item.operations.push({ operation: "transaction-read-update", status: "rejected", error: runtime.normalizeError(error) });
    }

    try {
      const readBack = await readDoc(ctx.db, COLLECTIONS.pollution, docId);
      item.operations.push({ operation: "read-back", status: "fulfilled", ownKeys: readBack ? Object.keys(readBack).sort() : null });
    } catch (error) {
      item.operations.push({ operation: "read-back", status: "rejected", error: runtime.normalizeError(error) });
    }

    results.push(item);
  }

  const after = pollutionSignature();
  const polluted =
    after.objectProtoPolluted ||
    after.arrayProtoPolluted ||
    after.objectConstructorPolluted ||
    after.pollutedObjectKeys;
  if (polluted) {
    console.error(JSON.stringify({
      level: "critical",
      event: "T0_PROBE_PROTOTYPE_POLLUTION_DETECTED",
      requestId: ctx.requestId || null,
      marker,
      before,
      after,
      evidenceSource: "structured-cloud-function-log",
      instanceTerminationDelayMs: 1500,
    }));
    setTimeout(() => {
      process.exit(2);
    }, 1500);
  }
  return {
    before,
    after,
    results,
    polluted,
    requestId: ctx.requestId || null,
    instanceDestroyScheduled: polluted,
    pass:
      !after.objectProtoPolluted &&
      !after.arrayProtoPolluted &&
      !after.objectConstructorPolluted &&
      !after.pollutedObjectKeys,
    note: "payload 一律从 JSON 字符串 JSON.parse 构造；若观察到原型污染，结构化云函数日志是主证据，并在 1500ms 后销毁实例。调用响应可能因实例退出而中断。",
  };
}

async function runCleanup(ctx) {
  const results = [];
  for (const collectionName of COLLECTION_NAMES) {
    results.push(await removeAllDocs(ctx.db, collectionName));
  }
  return {
    collections: results,
    remainingCollectionsMustBeDroppedInConsole: COLLECTION_NAMES,
    pass: results.every((item) => item.pass && item.finalCount === 0),
  };
}

async function run(ctx, action, event, runId) {
  switch (action) {
    case "status":
      return { message: "t0-probe ready", runId };
    case "preflight":
      return preflightTxWhereUpdate(ctx.db, ctx._);
    case "setup":
      return setupCollections(ctx);
    case "barrier":
      return armBarrier(ctx, event);
    case "d01":
      return runD01(ctx, event);
    case "d01_verify":
      return runD01Verify(ctx, event);
    case "d02":
      return runD02(ctx, event);
    case "d03":
      return runD03(ctx);
    case "d04":
      return runD04(ctx, event);
    case "d05":
      return runD05(ctx, event);
    case "d06":
      return runD06(ctx, event);
    case "d07":
      return runD07(ctx, event);
    case "d08":
      return runD08(ctx, event, runId);
    case "d09":
      return runD09(ctx, event);
    case "d10":
      return runD10(ctx);
    case "d11":
      return runD11();
    case "d12":
      return runD12(ctx, event);
    case "cleanup":
      return runCleanup(ctx);
    default:
      throw new Error(`unknown t0-probe action: ${action}`);
  }
}

module.exports = {
  run,
  setupCollections,
  runCleanup,
  __test: {
    transactionPath,
    evaluateD01FormalPass,
    evaluateD06Evidence,
    leasePreconditionFailure,
    D10_BASELINE_MS,
  },
};
