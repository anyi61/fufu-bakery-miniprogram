const nodeCrypto = require("node:crypto");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const STORE_ID = "store_xiaoyu_001";

const products = [
  [1,"发酵黄油可颂","法国黄油 · 27 层酥脆","今日现烤",1600,24,16,"热销 No.1","https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=86"],
  [2,"伯爵柑橘贝果","佛手柑茶香 · 低糖","今日现烤",1800,12,7,"新品","https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=86"],
  [3,"酸种乡村面包","天然酵母 · 18 小时慢发酵","欧包吐司",3200,12,9,"主厨推荐","https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=86"],
  [4,"肉桂苹果卷","焦糖苹果 · 锡兰肉桂","甜点",2400,11,5,"限定","https://images.unsplash.com/photo-1598373182133-52452f7691ef?auto=format&fit=crop&w=900&q=86"],
  [5,"火腿芝士恰巴塔","帕尔玛火腿 · 芝麻菜","咸味轻食",2800,12,8,"午餐推荐","https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=86"],
  [6,"海盐奶油卷","海盐黄油芯 · 柔软拉丝","今日现烤",1200,26,14,"人气","https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=86"]
].map(([id,name,subtitle,category,priceCents,plannedStock,soldStock,tag,imageUrl], index) => ({
  _id: String(id), id, name, subtitle, category, priceCents,
  initialPlannedStock: plannedStock, initialSoldStock: soldStock,
  isSoldOut: false, tag, imageUrl, sortOrder: index + 1,
}));

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function planId(...parts) {
  return parts.map((value) => String(value).replace(/[^A-Za-z0-9_-]/g, "_")).join("__");
}

function safeEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && nodeCrypto.timingSafeEqual(left, right);
}

function runtimeEnvironment(context, wxContext) {
  return context.namespace || context.namespace_id || context.environment ||
    process.env.SCF_NAMESPACE || process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID ||
    wxContext.ENV || wxContext.env || null;
}

function authorize(event, context, wxContext) {
  const expectedEnvironment = process.env.SEED_ENV_ID || "";
  const operatorToken = process.env.SEED_OPERATOR_TOKEN || "";
  const actualEnvironment = runtimeEnvironment(context, wxContext);
  if (process.env.SEED_ENABLED !== "true") throw new Error("SEED_DISABLED");
  if (event.action !== "apply") throw new Error("SEED_ACTION_DENIED");
  if (!expectedEnvironment || !actualEnvironment || actualEnvironment !== expectedEnvironment) throw new Error("SEED_ENVIRONMENT_DENIED");
  if (operatorToken.length < 32 || !safeEqual(event.operatorToken, operatorToken)) throw new Error("SEED_OPERATOR_DENIED");
}

exports.main = async (event = {}, context = {}) => {
  const wxContext = cloud.getWXContext();
  authorize(event, context, wxContext);

  const db = cloud.database();
  const staff = db.collection("staff");
  const owner = await staff.where({ openid: wxContext.OPENID, storeId: STORE_ID, role: "owner", active: true }).limit(1).get();
  if (!owner.data.length) throw new Error("SEED_OWNER_REQUIRED");

  const businessDate = today();
  const slots = [["1540","15:40","15:50",6],["1600","16:00","16:10",4],["1620","16:20","16:30",9]].map(([slotId, startsAt, endsAt, paidOrders]) => {
    const id = planId(STORE_ID, businessDate, slotId);
    return { _id: id, id, slotId, storeId: STORE_ID, businessDate, startsAt, endsAt, capacity: 12, reservedOrders: 0, paidOrders, isClosed: false, version: 0 };
  });
  for (const product of products) {
    const { initialPlannedStock, initialSoldStock, ...catalogProduct } = product;
    await db.collection("products").doc(product._id).set({ data: catalogProduct });
    const id = planId(STORE_ID, businessDate, product.id);
    await db.collection("inventory_plans").doc(id).set({ data: {
      _id: id, planId: id, storeId: STORE_ID, businessDate, skuId: String(product.id),
      plannedStock: initialPlannedStock, reservedUnits: 0, soldUnits: initialSoldStock,
      version: 0, updatedAt: db.serverDate(),
    } });
  }
  for (const slot of slots) await db.collection("slot_plans").doc(slot._id).set({ data: slot });
  return { ok: true, products: products.length, slots: slots.length };
};
