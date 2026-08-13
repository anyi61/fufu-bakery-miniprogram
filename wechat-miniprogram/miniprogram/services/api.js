const config = require("../config/runtime");
const seed = require("../data/seed");
const { slotText } = require("../utils/format");

const DEMO_KEY = "xiaoyu-demo-state-v1";

function availableProduct(product) {
  const availableStock = product.isSoldOut ? 0 : Math.max(0, product.plannedStock - product.soldStock - product.reservedStock);
  return { ...product, availableStock };
}

function availableSlot(slot) {
  const availableCapacity = slot.isClosed ? 0 : Math.max(0, slot.capacity - slot.paidCount - slot.reservedCount);
  return { ...slot, availableCapacity, displayTime: slotText(slot) };
}

function initialState() {
  return { products: seed.products.map(availableProduct), slots: seed.slots().map(availableSlot), orders: [], auditLogs: [], integrationEvents: [] };
}

function demoState() {
  const state = wx.getStorageSync(DEMO_KEY) || initialState();
  let changed = false;
  state.orders.filter((order) => order.status === "pending_payment" && order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now()).forEach((order) => {
    order.items.forEach((item) => { const product = state.products.find((current) => current.id === item.productId); product.reservedStock = Math.max(0, product.reservedStock - item.quantity); });
    const slot = state.slots.find((item) => item.id === order.slotId); slot.reservedCount = Math.max(0, slot.reservedCount - 1);
    order.status = "cancelled"; order.statusLabel = "已取消"; order.paymentStatus = "failed"; order.updatedAt = new Date().toISOString(); changed = true;
  });
  state.products = state.products.map(availableProduct);
  state.slots = state.slots.map(availableSlot);
  if (changed) saveDemo(state);
  return state;
}

function saveDemo(state) {
  wx.setStorageSync(DEMO_KEY, state);
  return state;
}

async function cloud(action, payload = {}) {
  const response = await wx.cloud.callFunction({ name: "bakery", data: { action, ...payload } });
  const result = response.result || {};
  if (!result.ok) throw new Error(result.error || "云服务请求失败");
  return result.data;
}

async function bootstrap(surface = "customer") {
  if (!config.demoMode) return cloud("bootstrap", { surface });
  const state = demoState();
  return { products: state.products, slots: state.slots, latestOrder: state.orders[0] || null, adapterMode: "demo", merchantAuthorized: true };
}

function id(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function reserveOrder(input) {
  if (!config.demoMode) return cloud("reserveOrder", { input });
  const state = demoState();
  const existing = state.orders.find((order) => order.idempotencyKey === input.idempotencyKey);
  if (existing) return existing;
  const slot = state.slots.find((item) => item.id === input.slotId);
  if (!slot || slot.availableCapacity < 1) throw new Error("该取货时段已约满");
  const lines = input.items.map((item) => {
    const product = state.products.find((current) => current.id === item.productId);
    if (!product || product.isSoldOut || product.availableStock < item.quantity) throw new Error(`${product ? product.name : "商品"}库存不足`);
    return { product, quantity: item.quantity };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
  const rawCode = `A${Math.floor(100 + Math.random() * 900)}`;
  const now = new Date().toISOString();
  const order = {
    id: id("ord_"), displayNumber: `XY${Math.floor(1000 + Math.random() * 9000)}`, pickupCodeDisplay: `${rawCode.slice(0, 2)} ${rawCode.slice(2)}`,
    pickupCodeRaw: rawCode, customerName: "张女士", customerPhoneMasked: "138 **** 0826", slotId: slot.id,
    status: "pending_payment", statusLabel: "待支付", paymentStatus: "pending", subtotalCents, packageFeeCents: 200,
    totalCents: subtotalCents + 200, remark: input.remark || "", adapterMode: "demo", idempotencyKey: input.idempotencyKey,
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), completedAt: null, slot: { ...slot },
    items: lines.map(({ product, quantity }) => ({ productId: product.id, productName: product.name, productSubtitle: product.subtitle, imageUrl: product.imageUrl, unitPriceCents: product.priceCents, quantity, lineTotalCents: product.priceCents * quantity }))
  };
  lines.forEach(({ product, quantity }) => { product.reservedStock += quantity; });
  slot.reservedCount += 1;
  state.orders.unshift(order);
  state.auditLogs.unshift({ action: "order.reserved", orderId: order.id, at: now });
  saveDemo(state);
  return order;
}

async function confirmPayment(orderId) {
  if (!config.demoMode) {
    if (config.paymentMode === "demo") return cloud("confirmDemoPayment", { orderId });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const data = await cloud("bootstrap", { surface: "customer" });
      if (data.latestOrder && data.latestOrder.id === orderId && data.latestOrder.paymentStatus === "paid") return data.latestOrder;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("支付结果确认中，请稍后到订单页查看");
  }
  const state = demoState();
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("订单不存在");
  if (order.paymentStatus === "paid") return order;
  if (order.status !== "pending_payment") throw new Error("订单当前不可支付");
  order.items.forEach((item) => {
    const product = state.products.find((current) => current.id === item.productId);
    product.reservedStock -= item.quantity;
    product.soldStock += item.quantity;
  });
  const slot = state.slots.find((item) => item.id === order.slotId);
  slot.reservedCount -= 1; slot.paidCount += 1;
  order.status = "pending_acceptance"; order.statusLabel = "待接单"; order.paymentStatus = "paid"; order.updatedAt = new Date().toISOString();
  order.slot = { ...slot };
  state.auditLogs.unshift({ action: "order.paid", orderId, at: order.updatedAt });
  state.integrationEvents.unshift({ provider: "demo-wechat-pay", operation: "payment.confirm", orderId, at: order.updatedAt });
  saveDemo(state);
  return order;
}

const labels = { accepted: "已接单", making: "制作中", ready: "待取货", completed: "已完成" };
const allowedNext = { pending_acceptance: "accepted", accepted: "making", making: "ready" };

async function transitionOrder(orderId, nextStatus, pickupCode) {
  if (!config.demoMode) return cloud("transitionOrder", { orderId, nextStatus, pickupCode });
  const state = demoState();
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("订单不存在");
  if (nextStatus === "completed") {
    if (order.status !== "ready") throw new Error("只有待取货订单可以核销");
    if ((pickupCode || "").replace(/\s/g, "").toUpperCase() !== order.pickupCodeRaw) throw new Error("取餐码不正确");
  } else if (allowedNext[order.status] !== nextStatus) throw new Error("订单状态已变化，请刷新");
  order.status = nextStatus;
  order.statusLabel = labels[nextStatus];
  order.updatedAt = new Date().toISOString();
  if (nextStatus === "completed") order.completedAt = order.updatedAt;
  state.auditLogs.unshift({ action: "order.status_changed", orderId, status: nextStatus, at: order.updatedAt });
  state.integrationEvents.unshift({ provider: nextStatus === "accepted" ? "demo-cloud-printer" : "demo-subscribe-message", operation: nextStatus, orderId, at: order.updatedAt });
  saveDemo(state);
  return order;
}

async function setProductAvailability(productId, isSoldOut) {
  if (!config.demoMode) return cloud("setProductAvailability", { productId, isSoldOut });
  const state = demoState();
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("商品不存在");
  product.isSoldOut = isSoldOut;
  state.auditLogs.unshift({ action: "product.availability_changed", productId, isSoldOut, at: new Date().toISOString() });
  saveDemo(state);
  return availableProduct(product);
}

function resetDemo() {
  wx.removeStorageSync(DEMO_KEY);
}

module.exports = { bootstrap, reserveOrder, confirmPayment, transitionOrder, setProductAvailability, resetDemo };
