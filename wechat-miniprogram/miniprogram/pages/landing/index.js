Page({
  goOrder() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  goProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  comingSoon(event) {
    const title = event.currentTarget.dataset.title || "该服务";
    wx.showToast({ title: title + "即将开放", icon: "none" });
  },
});
