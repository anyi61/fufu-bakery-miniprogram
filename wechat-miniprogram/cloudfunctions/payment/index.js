const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 正式启用前，需在微信云开发中开通云支付并配置自有商户号。
// 支付回调必须调用 bakery 云函数内部的 confirmPayment 等价逻辑，
// 以服务端查单/回调为准确认金额和订单归属，禁止相信小程序端成功回调。
exports.main = async (event) => {
  if (event.action !== "create") throw new Error("未知支付操作");
  throw new Error("微信支付尚未配置：请补充自有商户号并按 README 接入云支付");
};
