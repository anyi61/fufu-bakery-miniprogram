import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../wechat-miniprogram/", import.meta.url);

test("微信小程序工程配置完整且首发范围只有预约自提", async () => {
  const [project, app, runtime, readme] = await Promise.all([
    readFile(new URL("project.config.json", root), "utf8"),
    readFile(new URL("miniprogram/app.json", root), "utf8"),
    readFile(new URL("miniprogram/config/runtime.js", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  assert.equal(JSON.parse(project).miniprogramRoot, "miniprogram/");
  assert.equal(JSON.parse(project).cloudfunctionRoot, "cloudfunctions/");
  assert.ok(JSON.parse(app).pages.includes("pages/merchant/index"));
  assert.match(runtime, /demoMode: true/);
  assert.match(readme, /预约到店自提/);
  assert.doesNotMatch(runtime, /AppSecret|API v3|PRIVATE KEY/);
});

test("所有小程序与云函数 JavaScript 均可解析", async () => {
  async function walk(url) {
    const entries = await readdir(url, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) files.push(...await walk(child)); else if (entry.name.endsWith(".js")) files.push(child);
    }
    return files;
  }
  for (const file of await walk(root)) {
    const source = await readFile(file, "utf8");
    assert.doesNotThrow(() => new Function(source), file.pathname);
  }
});

test("确认订单页使用时间滚轮选择可约自提时段", async () => {
  const [template, page] = await Promise.all([
    readFile(new URL("miniprogram/pages/checkout/index.wxml", root), "utf8"),
    readFile(new URL("miniprogram/pages/checkout/index.js", root), "utf8"),
  ]);
  assert.match(template, /<picker[^>]+mode="selector"[^>]+bindchange="chooseSlot"/);
  assert.doesNotMatch(template, /bindtap="chooseSlot"/);
  assert.match(page, /Number\(event\.detail\.value\)/);
  assert.match(page, /availableCapacity > 0/);
});

test("时间滚轮更新当前时段且无效结算状态禁止提交", async () => {
  const require = createRequire(import.meta.url);
  const pagePath = fileURLToPath(new URL("miniprogram/pages/checkout/index.js", root));
  let definition;
  global.Page = (value) => { definition = value; };
  const app = { globalData: { selectedSlotId: 1 } };
  global.getApp = () => app;
  delete require.cache[pagePath];
  require(pagePath);
  const slots = [{ id: 1, displayTime: "15:40–15:50" }, { id: 2, displayTime: "16:00–16:10" }];
  const context = { data: { slots }, setData(value) { Object.assign(this.data, value); } };
  definition.chooseSlot.call(context, { detail: { value: "1" } });
  assert.equal(context.data.slotIndex, 1);
  assert.equal(context.data.slot.id, 2);
  assert.equal(app.globalData.selectedSlotId, 2);
  let toast;
  global.wx = { showToast(value) { toast = value; return value; } };
  const emptyCartContext = { data: { paying: false, lines: [], slot: slots[0] }, setData() { throw new Error("空购物车不应进入支付状态"); } };
  await definition.submit.call(emptyCartContext);
  assert.deepEqual(toast, { title: "购物车为空，请先选择商品", icon: "none" });
  const emptySlotContext = { data: { paying: false, lines: [{ id: 1 }], slot: null }, setData() { throw new Error("空时段不应进入支付状态"); } };
  await definition.submit.call(emptySlotContext);
  assert.deepEqual(toast, { title: "请选择可约取货时段", icon: "none" });
  delete global.Page;
  delete global.getApp;
  delete global.wx;
});

test("直接进入空购物车结算页时返回点单首页", async () => {
  const require = createRequire(import.meta.url);
  const pagePath = fileURLToPath(new URL("miniprogram/pages/checkout/index.js", root));
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { bootstrap: { products: [], slots: [] }, cart: {} } });
  let toast;
  let target;
  global.wx = {
    showToast(value) { toast = value; },
    switchTab(value) { target = value; return value; },
  };
  delete require.cache[pagePath];
  require(pagePath);
  definition.onLoad.call({ setData() { throw new Error("空购物车不应初始化结算金额"); } });
  assert.deepEqual(toast, { title: "购物车为空，请先选择商品", icon: "none" });
  assert.deepEqual(target, { url: "/pages/home/index" });
  delete global.Page;
  delete global.getApp;
  delete global.wx;
});

test("我的页面头像和菜单使用稳定的固定边界布局", async () => {
  const [template, styles, page] = await Promise.all([
    readFile(new URL("miniprogram/pages/profile/index.wxml", root), "utf8"),
    readFile(new URL("miniprogram/pages/profile/index.wxss", root), "utf8"),
    readFile(new URL("miniprogram/pages/profile/index.js", root), "utf8"),
  ]);
  assert.doesNotMatch(template, /<button class="avatar"/);
  assert.doesNotMatch(template, /<button class="menu-row"/);
  assert.match(template, /class="contact-hit" open-type="contact"/);
  assert.equal((template.match(/bindtap="comingSoon"/g) || []).length, 3);
  assert.match(page, /comingSoon\(event\)/);
  // Declarations are checked independently so harmless CSS reordering does not break the regression test.
  const avatarRule = styles.match(/\.avatar\{([^}]*)\}/)?.[1] || "";
  assert.match(avatarRule, /width:110rpx/);
  assert.match(avatarRule, /max-width:110rpx/);
  assert.match(avatarRule, /flex:0 0 110rpx/);
  const menuRowRule = styles.match(/\.menu-row\{([^}]*)\}/)?.[1] || "";
  assert.match(menuRowRule, /width:100%/);
  assert.match(menuRowRule, /display:flex/);
  assert.match(styles.match(/\.menu-label\{([^}]*)\}/)?.[1] || "", /flex:1/);
  assert.match(styles.match(/\.menu-arrow\{([^}]*)\}/)?.[1] || "", /flex:0 0 32rpx/);
});

test("我的页面未开放菜单提供明确反馈", async () => {
  const require = createRequire(import.meta.url);
  const pagePath = fileURLToPath(new URL("miniprogram/pages/profile/index.js", root));
  let definition;
  global.getApp = () => ({ globalData: { config: { demoMode: true } } });
  global.Page = (value) => { definition = value; };
  let toast;
  global.wx = { showToast(value) { toast = value; } };
  delete require.cache[pagePath];
  require(pagePath);
  definition.comingSoon({ currentTarget: { dataset: { title: "常用取货人" } } });
  assert.deepEqual(toast, { title: "常用取货人即将开放", icon: "none" });
  delete global.getApp;
  delete global.Page;
  delete global.wx;
});

test("首页样式不保留已移除的门店、时段和横向分类规则", async () => {
  const styles = await readFile(new URL("miniprogram/pages/home/index.wxss", root), "utf8");
  for (const selector of ["store-card", "store-name", "store-meta", "slot", "slot-time", "slot-right", "categories", "category-row"]) {
    assert.doesNotMatch(styles, new RegExp(`\\.${selector}(?:\\{|[ >.:])`));
  }
});

test("首页关键点单布局保持左右分栏与底部结算栏", async () => {
  const styles = await readFile(new URL("miniprogram/pages/home/index.wxss", root), "utf8");
  // 校验曾在真机中发生错位的关键布局契约，不限制其他页面可正常编译的选择器语法。
  const menuLayoutRule = styles.match(/\.menu-layout\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(menuLayoutRule, /display:\s*flex/);
  assert.match(menuLayoutRule, /overflow:\s*hidden/);
  const categoryPanelRule = styles.match(/\.category-panel\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(categoryPanelRule, /width:\s*166rpx/);
  assert.match(categoryPanelRule, /flex:\s*0 0 166rpx/);
  const menuRule = styles.match(/\.menu\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(menuRule, /min-width:\s*0/);
  assert.match(menuRule, /flex:\s*1/);
  const cartBarRule = styles.match(/\.cart-bar\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(cartBarRule, /position:\s*fixed/);
  assert.match(cartBarRule, /grid-template-columns:\s*88rpx minmax\(0, 1fr\) 194rpx/);
});

test("FUFU 视觉首页提供四栏入口且插画适合进入主包", async () => {
  const [appSource, template, page, artwork, ...tabIcons] = await Promise.all([
    readFile(new URL("miniprogram/app.json", root), "utf8"),
    readFile(new URL("miniprogram/pages/landing/index.wxml", root), "utf8"),
    readFile(new URL("miniprogram/pages/landing/index.js", root), "utf8"),
    readFile(new URL("miniprogram/assets/fufu/fufu-home-art.jpg", root)),
    ...["home", "order", "orders", "profile"].map((name) => readFile(new URL(`miniprogram/assets/fufu/tabbar/${name}.png`, root))),
  ]);
  const app = JSON.parse(appSource);
  assert.equal(app.pages[0], "pages/landing/index");
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ["首页", "点单", "订单", "我的"]);
  assert.ok(app.tabBar.list.every((item) => item.iconPath && item.selectedIconPath));
  assert.match(template, /class="hit hit-dine"[^>]+bindtap="goOrder"/);
  assert.match(template, /class="hit hit-member"[^>]+bindtap="goProfile"/);
  assert.match(template, /class="hit hit-express"[^>]+bindtap="express"/);
  assert.match(page, /wx\.switchTab\(\{ url: "\/pages\/home\/index" \}\)/);
  assert.ok(artwork.byteLength < 1024 * 1024, "首页插画应小于 1 MiB，避免挤占小程序主包");
  assert.ok(tabIcons.every((icon) => icon.byteLength < 40 * 1024), "tabBar 图标应满足微信 40 KiB 单文件限制");
});

test("体验模式跑通预占、支付、门店状态和动态取餐码核销", async () => {
  let storage;
  global.wx = {
    getStorageSync: () => storage,
    setStorageSync: (_key, value) => { storage = structuredClone(value); },
    removeStorageSync: () => { storage = undefined; },
  };
  const require = createRequire(import.meta.url);
  const apiPath = new URL("miniprogram/services/api.js", root);
  const api = require(fileURLToPath(apiPath));
  api.resetDemo();
  const before = await api.bootstrap();
  const order = await api.reserveOrder({ slotId: 1, items: [{ productId: 1, quantity: 1 }], idempotencyKey: "test-order", remark: "测试" });
  assert.equal(order.status, "pending_payment");
  let snapshot = await api.bootstrap();
  assert.equal(snapshot.products[0].reservedStock, 1);
  const paid = await api.confirmPayment(order.id);
  assert.equal(paid.status, "pending_acceptance");
  snapshot = await api.bootstrap();
  assert.equal(snapshot.products[0].reservedStock, 0);
  assert.equal(snapshot.products[0].soldStock, before.products[0].soldStock + 1);
  await api.transitionOrder(order.id, "accepted");
  await api.transitionOrder(order.id, "making");
  await api.transitionOrder(order.id, "ready");
  await assert.rejects(api.transitionOrder(order.id, "completed", "A000"), /取餐码不正确/);
  const completed = await api.transitionOrder(order.id, "completed", order.pickupCodeRaw);
  assert.equal(completed.status, "completed");
  const soldOut = await api.setProductAvailability(2, true);
  assert.equal(soldOut.isSoldOut, true);
  api.resetDemo();
  delete global.wx;
});
