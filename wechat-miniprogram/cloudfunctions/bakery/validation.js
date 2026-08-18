const MAX_ITEMS = 30;
const MAX_QUANTITY_PER_PRODUCT = 20;
const MAX_REMARK_LENGTH = 200;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const STRING_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeId(value, field) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && STRING_ID.test(value)) return value;
  throw new Error(field + "无效");
}

function normalizeReserveInput(input) {
  if (!isPlainObject(input)) throw new Error("订单参数无效");
  if (!Array.isArray(input.items) || input.items.length < 1) throw new Error("购物袋不能为空");
  if (input.items.length > MAX_ITEMS) throw new Error("商品种类过多");
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) throw new Error("幂等键无效");
  if (input.remark !== undefined && typeof input.remark !== "string") throw new Error("备注格式无效");
  const remark = (input.remark || "").trim();
  if (remark.length > MAX_REMARK_LENGTH) throw new Error("备注过长");

  const slotId = normalizeId(input.slotId, "取货时段");
  const quantities = new Map();
  for (const item of input.items) {
    if (!isPlainObject(item)) throw new Error("商品项无效");
    const productId = normalizeId(item.productId, "商品");
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_PRODUCT) {
      throw new Error("商品数量无效");
    }
    const quantity = (quantities.get(productId) || 0) + item.quantity;
    if (quantity > MAX_QUANTITY_PER_PRODUCT) throw new Error("单个商品数量超限");
    quantities.set(productId, quantity);
  }

  return {
    slotId,
    items: Array.from(quantities, ([productId, quantity]) => ({ productId, quantity })),
    remark,
    idempotencyKey: input.idempotencyKey,
  };
}

function requireStockSnapshot(product) {
  for (const field of ["priceCents", "plannedStock", "soldStock", "reservedStock"]) {
    if (!Number.isSafeInteger(product[field]) || product[field] < 0) throw new Error("商品库存数据异常");
  }
  if (product.soldStock + product.reservedStock > product.plannedStock) throw new Error("商品库存数据异常");
}

function requireSlotSnapshot(slot) {
  for (const field of ["capacity", "paidCount", "reservedCount"]) {
    if (!Number.isSafeInteger(slot[field]) || slot[field] < 0) throw new Error("取货时段数据异常");
  }
  if (slot.paidCount + slot.reservedCount > slot.capacity) throw new Error("取货时段数据异常");
}

module.exports = { normalizeReserveInput, requireSlotSnapshot, requireStockSnapshot };
