const api = require("../../services/api");
const payment = require("../../services/payment");
const notifications = require("../../services/notifications");
const { money } = require("../../utils/format");

Page({
  data: { lines: [], itemCount: 0, subtotal: "0", packageFee: "2", total: "0", slot: null, paying: false },
  onLoad() {
    const app = getApp(); const data = app.globalData.bootstrap; const cart = app.globalData.cart;
    if (!data) return wx.switchTab({ url: "/pages/home/index" });
    const lines = data.products.filter((product) => cart[product.id]).map((product) => ({ ...product, quantity: cart[product.id], lineTotal: money(product.priceCents * cart[product.id]), price: money(product.priceCents) }));
    const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    this.subtotalCents = subtotalCents;
    this.setData({ lines, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal: money(subtotalCents), total: money(subtotalCents + 200), slot: data.slots.find((slot) => slot.id === app.globalData.selectedSlotId) });
  },
  async submit() {
    if (this.data.paying) return;
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
