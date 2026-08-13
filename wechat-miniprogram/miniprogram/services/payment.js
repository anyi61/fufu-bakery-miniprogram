const config = require("../config/runtime");

async function pay(orderDraft) {
  if (config.paymentMode === "demo") {
    await new Promise((resolve) => setTimeout(resolve, 550));
    return { mode: "demo", paid: true };
  }
  const result = await wx.cloud.callFunction({ name: "payment", data: { action: "create", orderId: orderDraft.id } });
  if (!result.result || !result.result.payment) throw new Error("未取得微信支付参数");
  await wx.requestPayment(result.result.payment);
  return { mode: "wechat", paid: true };
}

module.exports = { pay };
