const cloud = require("wx-server-sdk");
const nodeCrypto = require("node:crypto");
const config = require("./config");
const adapters = require("./adapters");
const { hasPermission, permissionForTransition } = require("./authz");
const { STATUS_LABELS, NEXT, availableProduct, availableSlot } = require("./domain");
const {
  assertInventoryPlan,
  assertReservedTransition,
  assertSlotPlan,
  inventoryPlanId,
  reservationId,
  slotPlanId,
} = require("./ledger");
const { normalizeReserveInput } = require("./validation");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const c = {
  products: db.collection("products"),
  inventory: db.collection("inventory_plans"),
  slots: db.collection("slot_plans"),
  orders: db.collection("orders"),
  reservations: db.collection("order_reservations"),
  idempotency: db.collection("order_idempotency"),
  audit: db.collection("audit_logs"),
  events: db.collection("integration_events"),
  staff: db.collection("staff"),
};

function ok(data) { return { ok: true, data }; }
function fail(error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
function context() { return cloud.getWXContext(); }
function runtimeEnvironment(runtimeContext, wxContext) {
  return runtimeContext.namespace || runtimeContext.namespace_id || runtimeContext.environment ||
    process.env.SCF_NAMESPACE || process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID ||
    wxContext.ENV || wxContext.env || null;
}
function today() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function hash(value) { return nodeCrypto.createHash("sha256").update(value).digest("hex"); }
function pickupCode() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let raw = "";
  for (let index = 0; index < 8; index += 1) raw += alphabet[nodeCrypto.randomInt(alphabet.length)];
  return { raw, display: raw.slice(0, 4) + " " + raw.slice(4), hash: hash(raw) };
}
function idempotencyDigest(openid, businessDate, normalized) {
  const secret = process.env.IDEMPOTENCY_HMAC_KEY || "";
  if (secret.length < 32) throw new Error("幂等摘要密钥未配置");
  const canonical = JSON.stringify({
    storeId: config.storeId,
    businessDate,
    customerOpenId: openid,
    slotId: normalized.slotId,
    items: normalized.items,
    remark: normalized.remark,
  });
  return nodeCrypto.createHmac("sha256", secret).update(canonical).digest("hex");
}
function inventoryView(product, plan) {
  return availableProduct({
    ...product,
    plannedStock: plan ? plan.plannedStock : 0,
    reservedStock: plan ? plan.reservedUnits : 0,
    soldStock: plan ? plan.soldUnits : 0,
  });
}
function slotView(slot) {
  return availableSlot({
    ...slot,
    reservedCount: slot.reservedOrders,
    paidCount: slot.paidOrders,
  });
}
async function staffFor(openid) {
  const result = await c.staff.where({ openid, storeId: config.storeId, active: true }).limit(1).get();
  return result.data[0] || null;
}
async function requirePermission(openid, permission) {
  const staff = await staffFor(openid);
  if (!hasPermission(staff, permission, config.storeId)) throw new Error("需要门店员工权限");
  return staff;
}
async function log(action, entityType, entityId, openid, before, after) {
  await c.audit.add({ data: { action, entityType, entityId, actorOpenId: openid, before: before || null, after: after || null, createdAt: db.serverDate() } });
}
async function integration(event) { await c.events.add({ data: event }); }

async function ensureTodaySlots() {
  const businessDate = today();
  const existing = await c.slots.where({ storeId: config.storeId, businessDate }).limit(1).get();
  if (existing.data.length) return;
  const templates = [["1540", "15:40", "15:50"], ["1600", "16:00", "16:10"], ["1620", "16:20", "16:30"]];
  for (const [slotId, startsAt, endsAt] of templates) {
    const id = slotPlanId(config.storeId, businessDate, slotId);
    await c.slots.doc(id).set({ data: {
      _id: id, id, slotId, storeId: config.storeId, businessDate, startsAt, endsAt,
      capacity: 12, reservedOrders: 0, paidOrders: 0, isClosed: false, version: 0,
      createdAt: db.serverDate(), updatedAt: db.serverDate(),
    } });
  }
}

async function releaseExpiredReservations() {
  const expired = await c.orders.where({ status: "pending_payment", expiresAt: _.lte(new Date()) }).limit(50).get();
  for (const candidate of expired.data) {
    const released = await db.runTransaction(async (transaction) => {
      const orderResult = await transaction.collection("orders").doc(candidate.id).get();
      const order = orderResult.data;
      if (!order || order.status !== "pending_payment") return false;
      const reservationResult = await transaction.collection("order_reservations").doc(order.reservationId).get();
      const reservation = reservationResult.data;
      assertReservedTransition(reservation);
      for (const item of reservation.items) {
        const planId = inventoryPlanId(order.storeId, order.businessDate, item.skuId);
        const planResult = await transaction.collection("inventory_plans").doc(planId).get();
        const plan = planResult.data;
        assertInventoryPlan(plan, 0);
        if (plan.reservedUnits < item.quantity) throw new Error("商品预占计数异常");
        await transaction.collection("inventory_plans").doc(planId).update({ data: {
          reservedUnits: _.inc(-item.quantity), version: _.inc(1), updatedAt: db.serverDate(),
        } });
      }
      const slotResult = await transaction.collection("slot_plans").doc(order.slotPlanId).get();
      const slot = slotResult.data;
      assertSlotPlan(slot, false);
      if (slot.reservedOrders < 1) throw new Error("时段预占计数异常");
      await transaction.collection("slot_plans").doc(order.slotPlanId).update({ data: {
        reservedOrders: _.inc(-1), version: _.inc(1), updatedAt: db.serverDate(),
      } });
      await transaction.collection("order_reservations").doc(order.reservationId).update({ data: {
        state: "released_timeout", releasedBy: "system", releasedReason: "timeout",
        releasedAt: db.serverDate(), version: _.inc(1),
      } });
      await transaction.collection("orders").doc(order.id).update({ data: {
        status: "cancelled", statusLabel: STATUS_LABELS.cancelled, paymentStatus: "failed",
        settlementState: "released_timeout", orderSettledAt: db.serverDate(),
        expiresAt: null, version: _.inc(1), updatedAt: db.serverDate(),
      } });
      return true;
    });
    if (released) await log("order.expired", "order", candidate.id, "system", { status: "pending_payment" }, { status: "cancelled" });
  }
}

async function bootstrap(event, openid) {
  await releaseExpiredReservations();
  await ensureTodaySlots();
  const businessDate = today();
  const merchantStaff = event.surface === "merchant" ? await staffFor(openid) : null;
  const merchantAuthorized = hasPermission(merchantStaff, "order.read", config.storeId);
  const [productsResult, inventoryResult, slotsResult] = await Promise.all([
    c.products.orderBy("sortOrder", "asc").get(),
    c.inventory.where({ storeId: config.storeId, businessDate }).get(),
    c.slots.where({ storeId: config.storeId, businessDate }).orderBy("startsAt", "asc").get(),
  ]);
  const plans = new Map(inventoryResult.data.map((plan) => [String(plan.skuId), plan]));
  const selector = event.surface === "merchant" && merchantAuthorized ? {} : { customerOpenId: openid };
  const orderResult = await c.orders.where(selector).orderBy("createdAt", "desc").limit(1).get();
  return {
    products: productsResult.data.map((product) => inventoryView(product, plans.get(String(product.id)))),
    slots: slotsResult.data.map(slotView),
    latestOrder: orderResult.data[0] || null,
    adapterMode: config.adapterMode,
    merchantAuthorized,
  };
}

async function getOrder(event, openid) {
  if (typeof event.orderId !== "string" || !/^ord_[A-Za-z0-9_-]{8,80}$/.test(event.orderId)) throw new Error("订单编号无效");
  const result = await c.orders.doc(event.orderId).get();
  const order = result.data;
  if (!order || order.customerOpenId !== openid) throw new Error("订单不存在或无权查看");
  return order;
}

async function reserveOrder(input, openid) {
  const normalized = normalizeReserveInput(input);
  const businessDate = today();
  const requestDigest = idempotencyDigest(openid, businessDate, normalized);
  await releaseExpiredReservations();
  await ensureTodaySlots();
  const orderId = "ord_" + Date.now() + "_" + nodeCrypto.randomBytes(4).toString("hex");
  const reservationDocId = reservationId(orderId);
  const idempotencyId = hash(openid + ":" + normalized.idempotencyKey);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  return db.runTransaction(async (transaction) => {
    const idemResult = await transaction.collection("order_idempotency").doc(idempotencyId).get();
    const existingIdempotency = idemResult.data;
    if (existingIdempotency) {
      if (existingIdempotency.requestDigest !== requestDigest) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      const existingOrder = await transaction.collection("orders").doc(existingIdempotency.orderId).get();
      if (!existingOrder.data) throw new Error("幂等记录缺少订单");
      return existingOrder.data;
    }

    const slotResult = await transaction.collection("slot_plans").doc(normalized.slotId).get();
    const slot = slotResult.data;
    assertSlotPlan(slot);
    if (slot.storeId !== config.storeId || slot.businessDate !== businessDate) throw new Error("取货时段不属于当前门店日期");

    const lines = [];
    for (const item of normalized.items) {
      const [productResult, planResult] = await Promise.all([
        transaction.collection("products").doc(item.productId).get(),
        transaction.collection("inventory_plans").doc(inventoryPlanId(config.storeId, businessDate, item.productId)).get(),
      ]);
      const product = productResult.data;
      const plan = planResult.data;
      if (!product || product.isSoldOut) throw new Error((product ? product.name : "商品") + "不可售");
      assertInventoryPlan(plan, item.quantity);
      lines.push({ product, plan, skuId: item.productId, quantity: item.quantity });
    }

    const subtotalCents = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
    for (const line of lines) {
      await transaction.collection("inventory_plans").doc(line.plan._id).update({ data: {
        reservedUnits: _.inc(line.quantity), version: _.inc(1), updatedAt: db.serverDate(),
      } });
    }
    await transaction.collection("slot_plans").doc(slot._id).update({ data: {
      reservedOrders: _.inc(1), version: _.inc(1), updatedAt: db.serverDate(),
    } });

    const reservation = {
      _id: reservationDocId, reservationId: reservationDocId, orderId, customerOpenId: openid,
      storeId: config.storeId, businessDate, slotId: slot.slotId, slotPlanId: slot._id,
      items: lines.map((line) => ({ skuId: line.skuId, productId: line.product.id, quantity: line.quantity })),
      state: "reserved", releasedBy: null, releasedReason: null, settledAt: null, releasedAt: null, version: 0,
      createdAt: now, updatedAt: now,
    };
    const order = {
      _id: orderId, id: orderId, displayNumber: "XY" + Math.floor(1000 + Math.random() * 9000),
      pickupCodeHash: null, pickupCodeDisplay: null, customerOpenId: openid,
      customerName: "张女士", customerPhoneMasked: "138 **** 0826",
      storeId: config.storeId, businessDate, slotId: slot.slotId, slotPlanId: slot._id,
      reservationId: reservationDocId, status: "pending_payment", statusLabel: "待支付",
      paymentStatus: "pending", settlementState: "unsettled", version: 0,
      subtotalCents, packageFeeCents: 200, totalCents: subtotalCents + 200,
      remark: normalized.remark, adapterMode: config.adapterMode, idempotencyKey: normalized.idempotencyKey,
      createdAt: now, updatedAt: now, expiresAt, completedAt: null, orderSettledAt: null,
      items: lines.map(({ product, skuId, quantity }) => ({
        skuId, productId: product.id, productName: product.name, productSubtitle: product.subtitle,
        imageUrl: product.imageUrl, unitPriceCents: product.priceCents, quantity,
        lineTotalCents: product.priceCents * quantity,
      })),
      slot: slotView(slot),
    };
    await transaction.collection("order_reservations").doc(reservationDocId).set({ data: reservation });
    await transaction.collection("orders").doc(orderId).set({ data: order });
    await transaction.collection("order_idempotency").doc(idempotencyId).set({ data: {
      _id: idempotencyId, customerOpenId: openid, idempotencyKey: normalized.idempotencyKey,
      orderId, requestDigest, digestVersion: "hmac-sha256-v1", createdAt: now,
    } });
    return order;
  });
}

async function confirmDemoPayment(orderId, openid, runtimeContext) {
  if (config.paymentMode !== "demo") throw new Error("生产支付必须由微信支付回调确认");
  const expectedEnvironment = process.env.DEMO_PAYMENT_ENV_ID || "";
  const actualEnvironment = runtimeEnvironment(runtimeContext, context());
  if (process.env.ALLOW_DEMO_PAYMENT !== "true" || !expectedEnvironment || actualEnvironment !== expectedEnvironment) {
    throw new Error("模拟支付仅允许在绑定的隔离环境使用");
  }
  return confirmPayment(orderId, openid, "demo-pay-" + Date.now());
}

async function confirmPayment(orderId, openid, transactionId) {
  const code = pickupCode();
  const order = await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("orders").doc(orderId).get();
    const current = result.data;
    if (!current || current.customerOpenId !== openid) throw new Error("订单不存在或无权支付");
    if (current.paymentStatus === "paid") return current;
    if (current.status !== "pending_payment" || new Date(current.expiresAt).getTime() <= Date.now()) throw new Error("订单已过期");
    const reservationResult = await transaction.collection("order_reservations").doc(current.reservationId).get();
    const reservation = reservationResult.data;
    assertReservedTransition(reservation);
    for (const item of reservation.items) {
      const planId = inventoryPlanId(current.storeId, current.businessDate, item.skuId);
      const planResult = await transaction.collection("inventory_plans").doc(planId).get();
      const plan = planResult.data;
      assertInventoryPlan(plan, 0);
      if (plan.reservedUnits < item.quantity) throw new Error("商品预占计数异常");
      await transaction.collection("inventory_plans").doc(planId).update({ data: {
        reservedUnits: _.inc(-item.quantity), soldUnits: _.inc(item.quantity),
        version: _.inc(1), updatedAt: db.serverDate(),
      } });
    }
    const slotResult = await transaction.collection("slot_plans").doc(current.slotPlanId).get();
    const slot = slotResult.data;
    assertSlotPlan(slot, false);
    if (slot.reservedOrders < 1) throw new Error("时段预占计数异常");
    await transaction.collection("slot_plans").doc(current.slotPlanId).update({ data: {
      reservedOrders: _.inc(-1), paidOrders: _.inc(1), version: _.inc(1), updatedAt: db.serverDate(),
    } });
    await transaction.collection("order_reservations").doc(current.reservationId).update({ data: {
      state: "settled_paid", settledAt: db.serverDate(), version: _.inc(1), updatedAt: db.serverDate(),
    } });
    const update = {
      status: "pending_acceptance", statusLabel: STATUS_LABELS.pending_acceptance,
      paymentStatus: "paid", paymentTransactionId: transactionId,
      settlementState: "paid_settled", orderSettledAt: db.serverDate(),
      pickupCodeHash: code.hash, pickupCodeDisplay: code.display, pickupCodeGeneratedAt: db.serverDate(),
      expiresAt: null, version: _.inc(1), updatedAt: db.serverDate(),
    };
    await transaction.collection("orders").doc(orderId).update({ data: update });
    return { ...current, ...update };
  });
  await log("order.paid", "order", orderId, openid, { status: "pending_payment" }, { status: "pending_acceptance" });
  await integration(await adapters.syncPospal("order.sync", orderId));
  return order;
}

async function transitionOrder(event, openid) {
  const permission = permissionForTransition(event.nextStatus);
  if (!permission) throw new Error("订单状态操作无效");
  await requirePermission(openid, permission);
  const order = await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("orders").doc(event.orderId).get();
    const current = result.data;
    if (!current) throw new Error("订单不存在");
    if (current.storeId !== config.storeId) throw new Error("订单不属于当前门店");
    if (event.nextStatus === "completed") {
      if (current.status !== "ready") throw new Error("只有待取货订单可以核销");
      if (!event.pickupCode || hash(event.pickupCode.replace(/\s/g, "").toUpperCase()) !== current.pickupCodeHash) throw new Error("取餐码不正确");
    } else if (NEXT[current.status] !== event.nextStatus) {
      throw new Error("订单状态已变化，请刷新");
    }
    const changedAt = new Date();
    const updateData = {
      status: event.nextStatus, statusLabel: STATUS_LABELS[event.nextStatus],
      version: _.inc(1), updatedAt: changedAt,
    };
    if (event.nextStatus === "completed") updateData.completedAt = changedAt;
    await transaction.collection("orders").doc(current.id).update({ data: updateData });
    return {
      ...current,
      status: event.nextStatus,
      statusLabel: STATUS_LABELS[event.nextStatus],
      version: current.version + 1,
      updatedAt: changedAt,
      ...(event.nextStatus === "completed" ? { completedAt: changedAt } : {}),
    };
  });
  await log("order.status_changed", "order", order.id, openid, null, { status: event.nextStatus });
  const events = [
    await adapters.notifyOrder(order.id, event.nextStatus),
    await adapters.syncPospal("order.status", order.id),
  ];
  if (event.nextStatus === "accepted") events.push(await adapters.printOrder(order.id));
  await Promise.all(events.map(integration));
  return order;
}

async function setProductAvailability(event, openid) {
  await requirePermission(openid, "inventory.adjust");
  const result = await c.products.doc(String(event.productId)).get();
  if (!result.data) throw new Error("商品不存在");
  await c.products.doc(String(event.productId)).update({ data: { isSoldOut: Boolean(event.isSoldOut), updatedAt: db.serverDate() } });
  await log("product.availability_changed", "product", String(event.productId), openid, { isSoldOut: result.data.isSoldOut }, { isSoldOut: Boolean(event.isSoldOut) });
  await integration(await adapters.syncPospal("product.availability", String(event.productId)));
  return { ...result.data, isSoldOut: Boolean(event.isSoldOut) };
}

exports.main = async (event = {}, runtimeContext = {}) => {
  const openid = context().OPENID;
  try {
    switch (event.action) {
      case "bootstrap": return ok(await bootstrap(event, openid));
      case "getOrder": return ok(await getOrder(event, openid));
      case "reserveOrder": return ok(await reserveOrder(event.input, openid));
      case "confirmDemoPayment": return ok(await confirmDemoPayment(event.orderId, openid, runtimeContext));
      case "transitionOrder": return ok(await transitionOrder(event, openid));
      case "setProductAvailability": return ok(await setProductAvailability(event, openid));
      default: throw new Error("未知操作");
    }
  } catch (error) {
    console.error(event.action, error);
    return fail(error);
  }
};
