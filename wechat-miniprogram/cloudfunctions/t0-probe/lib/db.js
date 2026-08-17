"use strict";

const runtime = require("./runtime");

const COLLECTIONS = Object.freeze({
  orders: "t0probe_orders",
  attempts: "t0probe_attempts",
  condUpdate: "t0probe_cond_update",
  uniqueConflict: "t0probe_unique_conflict",
  txLimit: "t0probe_tx_limit",
  serverDate: "t0probe_server_date",
  timerLog: "t0probe_timer_log",
  leases: "t0probe_task_leases",
  barriers: "t0probe_barriers",
  pollution: "t0probe_pollution",
  meta: "t0probe_meta",
});

const COLLECTION_NAMES = Object.values(COLLECTIONS);

function underlyingTransaction(tx) {
  return tx && tx._transaction ? tx._transaction : tx;
}

async function txDocGet(tx, collectionName, docId) {
  const result = await tx.collection(collectionName).doc(docId).get();
  return {
    data: result.data || null,
    requestId: result.requestId || null,
  };
}

async function txDocSet(tx, collectionName, docId, data) {
  const payload = { ...data };
  delete payload._id;
  return tx.collection(collectionName).doc(docId).set({ data: payload });
}

async function txDocUpdate(tx, collectionName, docId, data) {
  return tx.collection(collectionName).doc(docId).update({ data });
}

function normalizeUpdateResult(result, method) {
  return {
    method,
    updated: (result && result.stats && result.stats.updated) || 0,
    requestId: (result && result.requestId) || null,
    result: result || null,
  };
}

async function txOfficialDocVersionUpdate(tx, collectionName, docId, expectedVersion, data) {
  const read = await txDocGet(tx, collectionName, docId);
  if (!read.data || read.data.version !== expectedVersion) {
    return {
      method: "official-doc",
      updated: 0,
      requestId: read.requestId,
      observedVersion: read.data ? read.data.version : null,
      reason: read.data ? "version-mismatch" : "not-found",
    };
  }
  const result = await txDocUpdate(tx, collectionName, docId, data);
  return {
    ...normalizeUpdateResult(result, "official-doc"),
    observedVersion: read.data.version,
  };
}

async function txOfficialWhereUpdate(tx, collectionName, where, data) {
  const result = await tx.collection(collectionName).where(where).update({ data });
  return normalizeUpdateResult(result, "official-where");
}

async function rawTxWhereUpdate(tx, collectionName, where, data) {
  const { QuerySerializer } = require("@cloudbase/database/dist/commonjs/serializer/query");
  const { UpdateSerializer } = require("@cloudbase/database/dist/commonjs/serializer/update");
  const rawTx = underlyingTransaction(tx);
  if (!rawTx || typeof rawTx.getTransactionId !== "function" || typeof rawTx.getRequestMethod !== "function") {
    throw new Error("rawTxWhereUpdate: transaction internals unavailable");
  }

  const request = rawTx.getRequestMethod();
  const params = {
    collectionName,
    transactionId: rawTx.getTransactionId(),
    queryType: "WHERE",
    multi: false,
    merge: true,
    upsert: false,
    query: QuerySerializer.encodeEJSON(where, false),
    data: UpdateSerializer.encodeEJSON(data, false),
  };
  const result = await request.send("database.modifyDocument", params);
  if (result && result.code) {
    const error = new Error(result.message || `rawTxWhereUpdate failed: ${result.code}`);
    error.code = result.code;
    error.raw = result;
    throw error;
  }
  return {
    method: "raw-diagnostic",
    updated: (result && result.data && result.data.updated) || 0,
    requestId: (result && result.requestId) || null,
    raw: result || null,
  };
}

async function txWhereUpdate(tx, collectionName, where, data, method) {
  if (method === "raw" || method === "raw-diagnostic") {
    return rawTxWhereUpdate(tx, collectionName, where, data);
  }
  return txOfficialWhereUpdate(tx, collectionName, where, data);
}

async function ensureDoc(db, collectionName, docId, data) {
  const payload = { ...data };
  delete payload._id;
  return db.collection(collectionName).doc(docId).set({ data: payload });
}

async function readDoc(db, collectionName, docId) {
  const result = await db.collection(collectionName).doc(docId).get();
  return (result && result.data) || null;
}

async function forcedRollbackConditionalProbe(db, _, method) {
  const docId = `t0probe_preflight_${method}_${Date.now()}`;
  await ensureDoc(db, COLLECTIONS.condUpdate, docId, { value: 1, version: 1, probe: "preflight" });

  const state = {
    method,
    docId,
    callbackRuns: 0,
    readRequestId: null,
    updateCalled: false,
    updateResult: null,
    forcedRollbackObserved: false,
    error: null,
  };

  try {
    await db.runTransaction(async (tx) => {
      state.callbackRuns += 1;
      const read = await txDocGet(tx, COLLECTIONS.condUpdate, docId);
      state.readRequestId = read.requestId;
      if (!read.data) throw new Error("preflight seed document missing inside transaction");

      state.updateResult = await txWhereUpdate(
        tx,
        COLLECTIONS.condUpdate,
        { _id: docId, version: read.data.version },
        { value: 99, version: _.inc(1) },
        method,
      );
      state.updateCalled = true;
      if (state.updateResult.updated !== 1) {
        const error = new Error(`preflight ${method} conditional update returned updated=${state.updateResult.updated}`);
        error.code = "T0_PRECONDITION_UPDATE_MISS";
        throw error;
      }
      throw runtime.forcedRollback(`T0 preflight ${method} forced rollback`);
    });
  } catch (error) {
    state.error = runtime.normalizeError(error);
  }

  const after = await readDoc(db, COLLECTIONS.condUpdate, docId);
  state.after = after
    ? { value: after.value, version: after.version }
    : null;
  state.forcedRollbackObserved = Boolean(state.error && state.error.code === "T0_FORCED_ROLLBACK");
  state.leakedOutsideTransaction = Boolean(after && after.value === 99);
  state.transactional = Boolean(
    state.updateCalled &&
      state.updateResult &&
      state.updateResult.updated === 1 &&
      state.forcedRollbackObserved &&
      after &&
      after.value === 1 &&
      after.version === 1,
  );
  state.pass = state.transactional;
  state.status = state.transactional
    ? "transactional"
    : state.leakedOutsideTransaction
      ? "leaked-outside-transaction"
      : "inconclusive-failed";
  return state;
}

async function forcedRollbackOfficialDocProbe(db, _) {
  const method = "official-doc";
  const docId = `t0probe_preflight_${method}_${Date.now()}`;
  await ensureDoc(db, COLLECTIONS.condUpdate, docId, { value: 1, version: 1, probe: "preflight" });
  const state = {
    method,
    docId,
    callbackRuns: 0,
    updateCalled: false,
    updateResult: null,
    forcedRollbackObserved: false,
    error: null,
  };
  try {
    await db.runTransaction(async (tx) => {
      state.callbackRuns += 1;
      state.updateResult = await txOfficialDocVersionUpdate(
        tx,
        COLLECTIONS.condUpdate,
        docId,
        1,
        { value: 99, version: _.inc(1) },
      );
      state.updateCalled = true;
      if (state.updateResult.updated !== 1) {
        const error = new Error(`preflight ${method} update returned updated=${state.updateResult.updated}`);
        error.code = "T0_PRECONDITION_UPDATE_MISS";
        throw error;
      }
      throw runtime.forcedRollback(`T0 preflight ${method} forced rollback`);
    });
  } catch (error) {
    state.error = runtime.normalizeError(error);
  }
  const after = await readDoc(db, COLLECTIONS.condUpdate, docId);
  state.after = after ? { value: after.value, version: after.version } : null;
  state.forcedRollbackObserved = Boolean(state.error && state.error.code === "T0_FORCED_ROLLBACK");
  state.transactional = Boolean(
    state.updateCalled &&
      state.updateResult &&
      state.updateResult.updated === 1 &&
      state.forcedRollbackObserved &&
      after &&
      after.value === 1 &&
      after.version === 1,
  );
  state.pass = state.transactional;
  state.status = state.transactional ? "transactional" : "inconclusive-failed";
  return state;
}

async function probeOfficialDocGetUpdateRace(db, _) {
  const docId = `t0probe_preflight_doc_race_${Date.now()}`;
  await ensureDoc(db, COLLECTIONS.condUpdate, docId, { value: 0, version: 1, probe: "preflight-doc-race" });

  async function worker(caller) {
    let callbackRuns = 0;
    const readLog = [];
    const transactionResult = await db.runTransaction(async (tx) => {
      callbackRuns += 1;
      const read = await txDocGet(tx, COLLECTIONS.condUpdate, docId);
      readLog.push({ step: "read", requestId: read.requestId, version: read.data && read.data.version });
      const update = await txDocUpdate(tx, COLLECTIONS.condUpdate, docId, {
        value: _.inc(1),
        version: _.inc(1),
        updatedAt: db.serverDate(),
      });
      readLog.push({ step: "doc-update", requestId: update.requestId || null, updated: update.stats.updated });
      return {
        caller,
        finalUpdated: update.stats.updated,
        requestIds: readLog.map((item) => item.requestId).filter(Boolean),
      };
    });
    return { caller, callbackRuns, transactionResult };
  }

  const settled = await runtime.allSettled([worker("A"), worker("B")]);
  const after = await readDoc(db, COLLECTIONS.condUpdate, docId);
  const fulfilled = settled.filter((item) => item.status === "fulfilled");
  const rejected = settled.filter((item) => item.status === "rejected");
  const unexpectedRejections = rejected.filter((item) => !/DATABASE_TRANSACTION_CONFLICT|TRANSACTION_CONFLICT|transaction conflict/i.test(`${item.reason.code || ""} ${item.reason.message || ""}`));

  return {
    docId,
    settled,
    fulfilled: fulfilled.length,
    rejected: rejected.length,
    unexpectedRejections,
    after: after ? { value: after.value, version: after.version } : null,
    pass: Boolean(
      fulfilled.length >= 1 &&
        unexpectedRejections.length === 0 &&
        after &&
        after.value === fulfilled.length &&
        after.version === fulfilled.length + 1,
    ),
  };
}

async function preflightTxWhereUpdate(db, _) {
  const officialDoc = await forcedRollbackOfficialDocProbe(db, _);
  const officialWhere = await forcedRollbackConditionalProbe(db, _, "official-where");
  const raw = await forcedRollbackConditionalProbe(db, _, "raw-diagnostic");
  const docRace = await probeOfficialDocGetUpdateRace(db, _);

  return {
    officialDocUpdate: {
      docId: officialDoc.docId,
      updateCalled: officialDoc.updateCalled,
      updateResult: officialDoc.updateResult,
      forcedRollbackObserved: officialDoc.forcedRollbackObserved,
      error: officialDoc.error,
      after: officialDoc.after,
      status: officialDoc.status,
      pass: officialDoc.pass,
    },
    officialWhereUpdate: {
      docId: officialWhere.docId,
      updateCalled: officialWhere.updateCalled,
      updateResult: officialWhere.updateResult,
      forcedRollbackObserved: officialWhere.forcedRollbackObserved,
      error: officialWhere.error,
      after: officialWhere.after,
      leakedOutsideTransaction: officialWhere.leakedOutsideTransaction,
      status: officialWhere.status,
      pass: officialWhere.pass,
      diagnosticOnly: true,
    },
    rawWhereUpdate: {
      docId: raw.docId,
      updateCalled: raw.updateCalled,
      updateResult: raw.updateResult,
      forcedRollbackObserved: raw.forcedRollbackObserved,
      error: raw.error,
      after: raw.after,
      leakedOutsideTransaction: raw.leakedOutsideTransaction,
      status: raw.status,
      pass: raw.pass,
      diagnosticOnly: true,
    },
    officialDocGetUpdateRace: docRace,
    summary: {
      pass: officialDoc.pass && docRace.pass,
      conclusion:
        officialDoc.pass && docRace.pass
          ? "公开 official-doc 事务路径通过强制回滚与并发冲突校验；official-where/raw 结果仅作兼容性诊断。"
          : "公开 official-doc 事务路径未通过强制回滚或并发冲突校验；不得以 official-where/raw 诊断路径替代正式协议。",
      officialWhereIsDiagnosticOnly: true,
      rawIsDiagnosticOnly: true,
    },
  };
}

module.exports = {
  COLLECTIONS,
  COLLECTION_NAMES,
  underlyingTransaction,
  txDocGet,
  txDocSet,
  txDocUpdate,
  txOfficialDocVersionUpdate,
  txOfficialWhereUpdate,
  txWhereUpdate,
  rawTxWhereUpdate,
  ensureDoc,
  readDoc,
  preflightTxWhereUpdate,
};
