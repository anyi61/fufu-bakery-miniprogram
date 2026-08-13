const config = require("../config/runtime");

async function requestOrderUpdates() {
  const tmplIds = Object.values(config.subscribeTemplateIds).filter(Boolean);
  if (!tmplIds.length) return { skipped: true };
  return wx.requestSubscribeMessage({ tmplIds });
}

module.exports = { requestOrderUpdates };
