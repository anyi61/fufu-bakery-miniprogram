const cloud = require("wx-server-sdk");
const nodeCrypto = require("crypto");
const config = require("./config");
const adapters = require("./adapters");
const { STATUS_LABELS, NEXT, availableProduct, availableSlot } = require("./domain");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const c = { products: db.collection("products"), slots: db.collection("pickup_slots"), orders: db.collection("orders"), audit: db.collection("audit_logs"), events: db.collection("integration_events"), staff: db.collection("staff") };

function ok(data) { return { ok: true, data }; }
function fail(error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
function context() { return cloud.getWXContext(); }
function today() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function pickupCode() { const raw = `A${Math.floor(100 + Math.random() * 900)}`; return { raw, display: `${raw.slice(0, 2)} ${raw.slice(2)}`, hash: nodeCrypto.createHash("sha256").update(raw).digest("hex") }; }
function hash(value) { return nodeCrypto.createHash("sha256").update(value).digest("hex"); }
async function isMerchant(openid) { if (config.merchantOpenIds.includes(openid)) return true; const result = await c.staff.where({ openid, active: true }).limit(1).get(); return result.data.length > 0; }
async function requireMerchant(openid) { if (!(await isMerchant(openid))) throw new Error("需要门店员工权限"); }
async function log(action, entityType, entityId, openid, before, after) { await c.audit.add({ data: { action, entityType, entityId, actorOpenId: openid, before: before || null, after: after || null, createdAt: db.serverDate() } }); }
async function integration(event) { await c.events.add({ data: event }); }

async function ensureTodaySlots() {
  const businessDate = today(); const existing = await c.slots.where({ businessDate }).limit(1).get();
  if (existing.data.length) return;
  const templates = [["15:40", "15:50"], ["16:00", "16:10"], ["16:20", "16:30"]];
  for (const [startsAt, endsAt] of templates) {
    const id = `${businessDate}_${startsAt.replace(":", "")}`;
    await c.slots.doc(id).set({ data: { _id: id, id, businessDate, startsAt, endsAt, capacity: 12, reservedCount: 0, paidCount: 0, isClosed: false, createdAt: db.serverDate(), updatedAt: db.serverDate() } });
  }
}

async function releaseExpiredReservations() {
  const expired = await c.orders.where({ status: "pending_payment", expiresAt: _.lte(new Date()) }).limit(50).get();
  for (const candidate of expired.data) {
    await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("orders").doc(candidate.id).get(); const order = result.data;
      if (!order || order.status !== "pending_payment") return;
      for (const item of order.items) await transaction.collection("products").doc(String(item.productId)).update({ data: { reservedStock: _.inc(-item.quantity), updatedAt: db.serverDate() } });
      await transaction.collection("pickup_slots").doc(String(order.slotId)).update({ data: { reservedCount: _.inc(-1), updatedAt: db.serverDate() } });
      await transaction.collection("orders").doc(order.id).update({ data: { status: "cancelled", statusLabel: STATUS_LABELS.cancelled, paymentStatus: "failed", expiresAt: null, updatedAt: db.serverDate() } });
    });
    await log("order.expired", "order", candidate.id, "system", { status: "pending_payment" }, { status: "cancelled" });
  }
}

async function bootstrap(event, openid) {
  await releaseExpiredReservations();
  await ensureTodaySlots();
  const merchantAuthorized = event.surface === "merchant" ? await isMerchant(openid) : false;
  const [productsResult, slotsResult] = await Promise.all([c.products.orderBy("sortOrder", "asc").get(), c.slots.where({ businessDate: today() }).orderBy("startsAt", "asc").get()]);
  const selector = event.surface === "merchant" && merchantAuthorized ? {} : { customerOpenId: openid };
  const orderResult = await c.orders.where(selector).orderBy("createdAt", "desc").limit(1).get();
  return { products: productsResult.data.map(availableProduct), slots: slotsResult.data.map(availableSlot), latestOrder: orderResult.data[0] || null, adapterMode: config.adapterMode, merchantAuthorized };
}

async function reserveOrder(input, openid) {
  await releaseExpiredReservations();
  await ensureTodaySlots();
  if (!input || !input.items || !input.items.length) throw new Error("购物袋不能为空");
  const existing = await c.orders.where({ customerOpenId: openid, idempotencyKey: input.idempotencyKey }).limit(1).get();
  if (existing.data[0]) return existing.data[0];
  const code = pickupCode(); const now = new Date(); const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  return db.runTransaction(async (transaction) => {
    const slotResult = await transaction.collection("pickup_slots").doc(String(input.slotId)).get(); const slot = slotResult.data;
    if (!slot || slot.isClosed || slot.capacity - slot.paidCount - slot.reservedCount < 1) throw new Error("该取货时段已约满");
    const lines = [];
    for (const item of input.items) {
      const productResult = await transaction.collection("products").doc(String(item.productId)).get(); const product = productResult.data;
      if (!product || product.isSoldOut || product.plannedStock - product.soldStock - product.reservedStock < item.quantity) throw new Error(`${product ? product.name : "商品"}库存不足`);
      lines.push({ product, quantity: item.quantity });
    }
    const subtotalCents = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0); const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    for (const line of lines) await transaction.collection("products").doc(String(line.product.id)).update({ data: { reservedStock: _.inc(line.quantity), updatedAt: db.serverDate() } });
    await transaction.collection("pickup_slots").doc(String(slot.id)).update({ data: { reservedCount: _.inc(1), updatedAt: db.serverDate() } });
    const order = { _id: orderId, id: orderId, displayNumber: `XY${Math.floor(1000 + Math.random() * 9000)}`, pickupCodeHash: code.hash, pickupCodeDisplay: code.display, customerOpenId: openid, customerName: "张女士", customerPhoneMasked: "138 **** 0826", slotId: slot.id, status: "pending_payment", statusLabel: "待支付", paymentStatus: "pending", subtotalCents, packageFeeCents: 200, totalCents: subtotalCents + 200, remark: input.remark || "", adapterMode: config.adapterMode, idempotencyKey: input.idempotencyKey, createdAt: now, updatedAt: now, expiresAt, completedAt: null, items: lines.map(({ product, quantity }) => ({ productId: product.id, productName: product.name, productSubtitle: product.subtitle, imageUrl: product.imageUrl, unitPriceCents: product.priceCents, quantity, lineTotalCents: product.priceCents * quantity })), slot: availableSlot(slot) };
    await transaction.collection("orders").doc(orderId).set({ data: order }); return order;
  });
}

async function confirmDemoPayment(orderId, openid) {
  if (config.paymentMode !== "demo") throw new Error("生产支付必须由微信支付回调确认");
  return confirmPayment(orderId, openid, `demo-pay-${Date.now()}`);
}

async function confirmPayment(orderId, openid, transactionId) {
  const order = await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("orders").doc(orderId).get(); const current = result.data;
    if (!current || current.customerOpenId !== openid) throw new Error("订单不存在或无权支付");
    if (current.paymentStatus === "paid") return current;
    if (current.status !== "pending_payment" || new Date(current.expiresAt).getTime() <= Date.now()) throw new Error("订单已过期");
    for (const item of current.items) await transaction.collection("products").doc(String(item.productId)).update({ data: { reservedStock: _.inc(-item.quantity), soldStock: _.inc(item.quantity), updatedAt: db.serverDate() } });
    await transaction.collection("pickup_slots").doc(String(current.slotId)).update({ data: { reservedCount: _.inc(-1), paidCount: _.inc(1), updatedAt: db.serverDate() } });
    const update = { status: "pending_acceptance", statusLabel: STATUS_LABELS.pending_acceptance, paymentStatus: "paid", paymentTransactionId: transactionId, expiresAt: null, updatedAt: db.serverDate() };
    await transaction.collection("orders").doc(orderId).update({ data: update }); return { ...current, ...update };
  });
  await log("order.paid", "order", orderId, openid, { status: "pending_payment" }, { status: "pending_acceptance" });
  await integration(await adapters.syncPospal("order.sync", orderId)); return order;
}

async function transitionOrder(event, openid) {
  await requireMerchant(openid); const result = await c.orders.doc(event.orderId).get(); const order = result.data;
  if (!order) throw new Error("订单不存在");
  if (event.nextStatus === "completed") { if (order.status !== "ready") throw new Error("只有待取货订单可以核销"); if (!event.pickupCode || hash(event.pickupCode.replace(/\s/g, "").toUpperCase()) !== order.pickupCodeHash) throw new Error("取餐码不正确"); }
  else if (NEXT[order.status] !== event.nextStatus) throw new Error("订单状态已变化，请刷新");
  const update = { status: event.nextStatus, statusLabel: STATUS_LABELS[event.nextStatus], updatedAt: db.serverDate() }; if (event.nextStatus === "completed") update.completedAt = db.serverDate();
  await c.orders.doc(order.id).update({ data: update }); await log("order.status_changed", "order", order.id, openid, { status: order.status }, { status: event.nextStatus });
  const events = [await adapters.notifyOrder(order.id, event.nextStatus), await adapters.syncPospal("order.status", order.id)]; if (event.nextStatus === "accepted") events.push(await adapters.printOrder(order.id)); await Promise.all(events.map(integration)); return { ...order, ...update };
}

async function setProductAvailability(event, openid) { await requireMerchant(openid); const result = await c.products.doc(String(event.productId)).get(); if (!result.data) throw new Error("商品不存在"); await c.products.doc(String(event.productId)).update({ data: { isSoldOut: Boolean(event.isSoldOut), updatedAt: db.serverDate() } }); await log("product.availability_changed", "product", String(event.productId), openid, { isSoldOut: result.data.isSoldOut }, { isSoldOut: Boolean(event.isSoldOut) }); await integration(await adapters.syncPospal("product.availability", String(event.productId))); return availableProduct({ ...result.data, isSoldOut: Boolean(event.isSoldOut) }); }

exports.main = async (event) => { const openid = context().OPENID; try { switch (event.action) { case "bootstrap": return ok(await bootstrap(event, openid)); case "reserveOrder": return ok(await reserveOrder(event.input, openid)); case "confirmDemoPayment": return ok(await confirmDemoPayment(event.orderId, openid)); case "transitionOrder": return ok(await transitionOrder(event, openid)); case "setProductAvailability": return ok(await setProductAvailability(event, openid)); default: throw new Error("未知操作"); } } catch (error) { console.error(event.action, error); return fail(error); } };
