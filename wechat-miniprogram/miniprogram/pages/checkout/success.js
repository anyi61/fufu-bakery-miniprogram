const api = require("../../services/api");
Page({
  data: { order: null },
  onLoad(options) { this.orderId = options.orderId; },
  async onShow() {
    try {
      const order = await api.getOrder(this.orderId);
      this.setData({ order });
    } catch (error) {
      wx.showToast({ title: error.message || "订单加载失败", icon: "none" });
    }
  },
  orders() { wx.switchTab({ url: "/pages/orders/index" }); },
  merchant() { wx.navigateTo({ url: "/pages/merchant/index" }); },
});
