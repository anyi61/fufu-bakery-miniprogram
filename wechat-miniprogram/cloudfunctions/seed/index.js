const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const products = [
  [1,"发酵黄油可颂","法国黄油 · 27 层酥脆","今日现烤",1600,24,16,"热销 No.1","https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=86"],
  [2,"伯爵柑橘贝果","佛手柑茶香 · 低糖","今日现烤",1800,12,7,"新品","https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=86"],
  [3,"酸种乡村面包","天然酵母 · 18 小时慢发酵","欧包吐司",3200,12,9,"主厨推荐","https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=86"],
  [4,"肉桂苹果卷","焦糖苹果 · 锡兰肉桂","甜点",2400,11,5,"限定","https://images.unsplash.com/photo-1598373182133-52452f7691ef?auto=format&fit=crop&w=900&q=86"],
  [5,"火腿芝士恰巴塔","帕尔玛火腿 · 芝麻菜","咸味轻食",2800,12,8,"午餐推荐","https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=86"],
  [6,"海盐奶油卷","海盐黄油芯 · 柔软拉丝","今日现烤",1200,26,14,"人气","https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=86"]
].map(([id,name,subtitle,category,priceCents,plannedStock,soldStock,tag,imageUrl], index) => ({ _id: String(id), id, name, subtitle, category, priceCents, plannedStock, soldStock, reservedStock: 0, isSoldOut: false, tag, imageUrl, sortOrder: index + 1 }));
function today(){ return new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10); }
const slots = [["15:40","15:50",6],["16:00","16:10",4],["16:20","16:30",9]].map(([startsAt,endsAt,paidCount]) => { const businessDate=today(); const id=`${businessDate}_${startsAt.replace(":","")}`; return { _id:id, id, businessDate, startsAt, endsAt, capacity:12, reservedCount:0, paidCount, isClosed:false }; });
exports.main = async () => { const ctx = cloud.getWXContext(); const staff = db.collection("staff"); for (const product of products) await db.collection("products").doc(product._id).set({ data: product }); for (const slot of slots) await db.collection("pickup_slots").doc(slot._id).set({ data: slot }); const existing = await staff.where({ openid: ctx.OPENID }).limit(1).get(); if (!existing.data.length) await staff.add({ data: { openid: ctx.OPENID, role: "owner", active: true, createdAt: db.serverDate() } }); return { ok:true, products:products.length, slots:slots.length, ownerOpenId:ctx.OPENID }; };
