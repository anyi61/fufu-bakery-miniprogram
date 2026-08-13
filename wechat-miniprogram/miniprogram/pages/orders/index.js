const api = require("../../services/api");
const { money } = require("../../utils/format");
Page({
  data: { loading: true, order: null, total: "0", itemCount: 0 },
  onShow() { this.load(); this.timer = setInterval(() => this.load(true), 5000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  async load(quiet) { try { const data = await api.bootstrap("customer"); const order = data.latestOrder; this.setData({ order, total: order ? money(order.totalCents) : "0", itemCount: order ? order.items.reduce((sum, item) => sum + item.quantity, 0) : 0, loading: false }); } catch (error) { if (!quiet) wx.showToast({ title: error.message || "加载失败", icon: "none" }); } },
  orderFood() { wx.switchTab({ url: "/pages/home/index" }); },
  merchant() { wx.navigateTo({ url: "/pages/merchant/index" }); }
});
