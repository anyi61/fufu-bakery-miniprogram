const STATUS_LABELS = { pending_payment: "待支付", pending_acceptance: "待接单", accepted: "已接单", making: "制作中", ready: "待取货", completed: "已完成", cancelled: "已取消" };
const NEXT = { pending_acceptance: "accepted", accepted: "making", making: "ready" };
function availableProduct(product) { return { ...product, availableStock: product.isSoldOut ? 0 : Math.max(0, product.plannedStock - product.soldStock - product.reservedStock) }; }
function availableSlot(slot) { return { ...slot, availableCapacity: slot.isClosed ? 0 : Math.max(0, slot.capacity - slot.paidCount - slot.reservedCount), displayTime: `${slot.startsAt}–${slot.endsAt}` }; }
module.exports = { STATUS_LABELS, NEXT, availableProduct, availableSlot };
