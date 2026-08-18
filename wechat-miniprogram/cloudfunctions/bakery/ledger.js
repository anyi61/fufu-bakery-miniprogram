function encodePart(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_");
}

function inventoryPlanId(storeId, businessDate, skuId) {
  return [storeId, businessDate, skuId].map(encodePart).join("__");
}

function slotPlanId(storeId, businessDate, slotId) {
  return [storeId, businessDate, slotId].map(encodePart).join("__");
}

function reservationId(orderId) {
  return "res_" + encodePart(orderId);
}

function availableUnits(plan) {
  return plan.plannedStock - plan.reservedUnits - plan.soldUnits;
}

function availableOrders(plan) {
  return plan.capacity - plan.reservedOrders - plan.paidOrders;
}

function assertInventoryPlan(plan, quantity) {
  if (!plan) throw new Error("商品日期库存未配置");
  for (const field of ["plannedStock", "reservedUnits", "soldUnits", "version"]) {
    if (!Number.isSafeInteger(plan[field]) || plan[field] < 0) throw new Error("商品日期库存数据异常");
  }
  if (plan.reservedUnits + plan.soldUnits > plan.plannedStock) throw new Error("商品日期库存数据异常");
  if (availableUnits(plan) < quantity) throw new Error("商品库存不足");
}

function assertSlotPlan(plan, requireAvailability = true) {
  if (!plan) throw new Error("取货时段未配置");
  for (const field of ["capacity", "reservedOrders", "paidOrders", "version"]) {
    if (!Number.isSafeInteger(plan[field]) || plan[field] < 0) throw new Error("取货时段数据异常");
  }
  if (plan.reservedOrders + plan.paidOrders > plan.capacity) throw new Error("取货时段数据异常");
  if (requireAvailability && (plan.isClosed || availableOrders(plan) < 1)) throw new Error("该取货时段已约满");
}

function assertReservedTransition(reservation) {
  if (!reservation || reservation.state !== "reserved") throw new Error("订单预占状态异常");
}

module.exports = {
  assertInventoryPlan,
  assertReservedTransition,
  assertSlotPlan,
  availableOrders,
  availableUnits,
  inventoryPlanId,
  reservationId,
  slotPlanId,
};
