const api = require("../../services/api");
Page({ data: { order: null }, onLoad(options) { this.orderId = options.orderId; }, async onShow() { const data = await api.bootstrap("customer"); this.setData({ order: data.latestOrder }); }, orders() { wx.switchTab({ url: "/pages/orders/index" }); }, merchant() { wx.navigateTo({ url: "/pages/merchant/index" }); } });
