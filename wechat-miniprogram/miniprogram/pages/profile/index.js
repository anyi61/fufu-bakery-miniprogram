const api = require("../../services/api");
Page({
  data: { userInfo: null, demoMode: getApp().globalData.config.demoMode },
  async login() { try { const result = await wx.getUserProfile({ desc: "用于展示取货人头像和昵称" }); this.setData({ userInfo: result.userInfo }); } catch (error) { if (error && !String(error.errMsg || error.message || error).includes("cancel")) wx.showToast({ title: "授权失败", icon: "none" }); } },
  comingSoon(event) { wx.showToast({ title: `${event.currentTarget.dataset.title}即将开放`, icon: "none" }); },
  merchant() { wx.navigateTo({ url: "/pages/merchant/index" }); },
  reset() { api.resetDemo(); getApp().globalData.cart = {}; wx.showToast({ title: "体验数据已重置" }); }
});
