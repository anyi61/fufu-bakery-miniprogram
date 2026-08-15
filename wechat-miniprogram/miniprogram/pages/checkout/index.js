const api = require("../../services/api");
const payment = require("../../services/payment");
const notifications = require("../../services/notifications");
const { money } = require("../../utils/format");

Page({
  data: { lines: [], itemCount: 0, subtotal: "0", packageFee: "2", total: "0", slots: [], slotIndex: 0, slot: null, paying: false },
  onLoad() {
    const app = getApp(); const data = app.globalData.bootstrap; const cart = app.globalData.cart || {};
    if (!data) return wx.switchTab({ url: "/pages/home/index" });
    const lines = data.products.filter((product) => cart[product.id]).map((product) => ({ ...product, quantity: cart[product.id], lineTotal: money(product.priceCents * cart[product.id]), price: money(product.priceCents) }));
    if (!lines.length) {
      wx.showToast({ title: "购物车为空，请先选择商品", icon: "none" });
      return wx.switchTab({ url: "/pages/home/index" });
    }
    const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    const slots = data.slots.filter((item) => !item.isClosed && item.availableCapacity > 0).map((item) => ({ ...item, pickerLabel: `${item.displayTime} · 余 ${item.availableCapacity} 单` }));
    const slot = slots.find((item) => item.id === app.globalData.selectedSlotId) || slots[0] || null;
    app.globalData.selectedSlotId = slot ? slot.id : null;
    this.subtotalCents = subtotalCents;
    this.setData({ lines, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal: money(subtotalCents), total: money(subtotalCents + 200), slots, slotIndex: slot ? slots.indexOf(slot) : 0, slot });
  },
  chooseSlot(event) {
    if (!this.data.slots.length) return wx.showToast({ title: "暂无可约时段", icon: "none" });
    const slotIndex = Number(event.detail.value);
    const slot = this.data.slots[slotIndex];
    if (!slot) return;
    getApp().globalData.selectedSlotId = slot.id;
    this.setData({ slotIndex, slot });
  },
  async submit() {
    if (this.data.paying) return;
    if (!this.data.lines.length) return wx.showToast({ title: "购物车为空，请先选择商品", icon: "none" });
    if (!this.data.slot) return wx.showToast({ title: "请选择可约取货时段", icon: "none" });
    this.setData({ paying: true });
    try {
      const reserved = await api.reserveOrder({ slotId: this.data.slot.id, items: this.data.lines.map((line) => ({ productId: line.id, quantity: line.quantity })), remark: "可颂请装纸袋", idempotencyKey: `wx_${Date.now()}_${Math.random().toString(36).slice(2)}` });
      await payment.pay(reserved);
      const order = await api.confirmPayment(reserved.id);
      getApp().globalData.cart = {};
      await notifications.requestOrderUpdates().catch(() => null);
      wx.redirectTo({ url: `/pages/checkout/success?orderId=${order.id}` });
    } catch (error) { wx.showToast({ title: error.message || "下单失败", icon: "none" }); this.setData({ paying: false }); }
  }
});
