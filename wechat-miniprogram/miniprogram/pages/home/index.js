const api = require("../../services/api");
const { money, slotText } = require("../../utils/format");

Page({
  data: { loading: true, categories: ["全部", "今日现烤", "欧包吐司", "咸味轻食", "甜点"], category: "全部", products: [], visibleProducts: [], slots: [], slotIndex: 0, selectedSlot: null, cart: {}, itemCount: 0, subtotal: "0" },
  onShow() { this.load(); },
  async load() {
    try {
      const data = await api.bootstrap("customer");
      const app = getApp();
      const selected = data.slots.find((slot) => slot.id === app.globalData.selectedSlotId) || data.slots[0] || null;
      app.globalData.bootstrap = data;
      app.globalData.selectedSlotId = selected ? selected.id : null;
      this.setData({ products: data.products, slots: data.slots, selectedSlot: selected, slotIndex: Math.max(0, data.slots.indexOf(selected)), loading: false });
      this.syncCart(); this.filter();
    } catch (error) { wx.showToast({ title: error.message || "加载失败", icon: "none" }); this.setData({ loading: false }); }
  },
  filter() { const { products, category } = this.data; this.setData({ visibleProducts: category === "全部" ? products : products.filter((item) => item.category === category) }); },
  chooseCategory(event) { this.setData({ category: event.currentTarget.dataset.value }); this.filter(); },
  chooseSlot() {
    if (!this.data.slots.length) return;
    const slotIndex = (this.data.slotIndex + 1) % this.data.slots.length;
    const selectedSlot = this.data.slots[slotIndex];
    getApp().globalData.selectedSlotId = selectedSlot.id;
    this.setData({ slotIndex, selectedSlot });
  },
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
    this.setData({ cart, itemCount, subtotal: money(subtotalCents) });
  },
  checkout() { if (!this.data.selectedSlot) return wx.showToast({ title: "暂无可约时段", icon: "none" }); wx.navigateTo({ url: "/pages/checkout/index" }); },
  slotText
});
