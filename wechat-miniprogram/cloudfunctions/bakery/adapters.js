const config = require("./config");
function result(provider, operation, entityId) { return { provider, operation, entityId, reference: `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: "succeeded", createdAt: new Date() }; }
async function syncPospal(operation, entityId) { return result(config.pospal.enabled ? "pospal" : "demo-pospal", operation, entityId); }
async function printOrder(orderId) { return result(config.printer.enabled ? "cloud-printer" : "demo-cloud-printer", "print.order", orderId); }
async function notifyOrder(orderId, status) { return result("demo-subscribe-message", `notify.${status}`, orderId); }
module.exports = { syncPospal, printOrder, notifyOrder };
