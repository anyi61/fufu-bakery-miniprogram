Page({
  goOrder() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  goProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  express() {
    wx.showToast({ title: "快递邮寄即将开放", icon: "none" });
  },
});
