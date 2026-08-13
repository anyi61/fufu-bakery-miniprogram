const config = require("./config/runtime");

App({
  globalData: {
    config,
    cart: {},
    selectedSlotId: null,
    bootstrap: null,
  },

  onLaunch() {
    if (!config.demoMode && wx.cloud) {
      wx.cloud.init({ env: config.cloudEnvId || undefined, traceUser: true });
    }
  },
});
