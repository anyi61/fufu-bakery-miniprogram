const api = require("../../services/api");
const { money } = require("../../utils/format");
const PACKAGE_FEE_CENTS = 200;

Page({
  data: { loading: true, categories: ["全部", "今日现烤", "欧包吐司", "咸味轻食", "甜点"], category: "全部", products: [], visibleProducts: [], cart: {}, itemCount: 0, subtotal: "0", payable: "0" },
  onShow() { this.load(); },
  async load() {
    try {
      const data = await api.bootstrap("customer");
      const app = getApp();
      app.globalData.bootstrap = data;
      this.setData({ products: data.products, loading: false });
      this.syncCart(); this.filter();
    } catch (error) { wx.showToast({ title: error.message || "加载失败", icon: "none" }); this.setData({ loading: false }); }
  },
  filter() { const { products, category } = this.data; this.setData({ visibleProducts: category === "全部" ? products : products.filter((item) => item.category === category) }); },
  chooseCategory(event) { this.setData({ category: event.currentTarget.dataset.value }); this.filter(); },
  add(event) {
    const product = event.detail.product;
    const cart = { ...getApp().globalData.cart };
    const quantity = cart[product.id] || 0;
    if (quantity >= product.availableStock) return wx.showToast({ title: "已达到可售余量", icon: "none" });
    cart[product.id] = quantity + 1; getApp().globalData.cart = cart; this.syncCart();
  },
  remove(event) {
    const cart = { ...getApp().globalData.cart }; const id = event.detail.productId;
    if ((cart[id] || 0) <= 1) delete cart[id]; else cart[id] -= 1;
    getApp().globalData.cart = cart; this.syncCart();
  },
  syncCart() {
    const cart = getApp().globalData.cart;
    const subtotalCents = this.data.products.reduce((sum, product) => sum + product.priceCents * (cart[product.id] || 0), 0);
    const itemCount = Object.values(cart).reduce((sum, value) => sum + value, 0);
    this.setData({ cart, itemCount, subtotal: money(subtotalCents), payable: money(subtotalCents + (itemCount ? PACKAGE_FEE_CENTS : 0)) });
  },
  checkout() { wx.navigateTo({ url: "/pages/checkout/index" }); }
});
