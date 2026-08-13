const products = [
  { id: 1, name: "发酵黄油可颂", subtitle: "法国黄油 · 27 层酥脆", category: "今日现烤", priceCents: 1600, plannedStock: 24, soldStock: 16, reservedStock: 0, isSoldOut: false, tag: "热销 No.1", imageUrl: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=86" },
  { id: 2, name: "伯爵柑橘贝果", subtitle: "佛手柑茶香 · 低糖", category: "今日现烤", priceCents: 1800, plannedStock: 12, soldStock: 7, reservedStock: 0, isSoldOut: false, tag: "新品", imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=86" },
  { id: 3, name: "酸种乡村面包", subtitle: "天然酵母 · 18 小时慢发酵", category: "欧包吐司", priceCents: 3200, plannedStock: 12, soldStock: 9, reservedStock: 0, isSoldOut: false, tag: "主厨推荐", imageUrl: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=86" },
  { id: 4, name: "肉桂苹果卷", subtitle: "焦糖苹果 · 锡兰肉桂", category: "甜点", priceCents: 2400, plannedStock: 11, soldStock: 5, reservedStock: 0, isSoldOut: false, tag: "限定", imageUrl: "https://images.unsplash.com/photo-1598373182133-52452f7691ef?auto=format&fit=crop&w=900&q=86" },
  { id: 5, name: "火腿芝士恰巴塔", subtitle: "帕尔玛火腿 · 芝麻菜", category: "咸味轻食", priceCents: 2800, plannedStock: 12, soldStock: 8, reservedStock: 0, isSoldOut: false, tag: "午餐推荐", imageUrl: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=86" },
  { id: 6, name: "海盐奶油卷", subtitle: "海盐黄油芯 · 柔软拉丝", category: "今日现烤", priceCents: 1200, plannedStock: 26, soldStock: 14, reservedStock: 0, isSoldOut: false, tag: "人气", imageUrl: "https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=86" }
];

function today() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date;
}

function slots() {
  return [
    { id: 1, businessDate: today(), startsAt: "15:40", endsAt: "15:50", capacity: 12, paidCount: 6, reservedCount: 0, isClosed: false },
    { id: 2, businessDate: today(), startsAt: "16:00", endsAt: "16:10", capacity: 12, paidCount: 4, reservedCount: 0, isClosed: false },
    { id: 3, businessDate: today(), startsAt: "16:20", endsAt: "16:30", capacity: 12, paidCount: 9, reservedCount: 0, isClosed: false }
  ];
}

module.exports = { products, slots };
