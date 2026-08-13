const api = require("../../services/api");
const { money } = require("../../utils/format");
const nextStatus = { pending_acceptance: "accepted", accepted: "making", making: "ready" };
const nextLabel = { pending_acceptance: "接单并打印", accepted: "开始制作", making: "标记已备妥" };

Page({
  data: { tab: "orders", loading: true, authorized: true, order: null, products: [], slots: [], total: "0", nextStatus: null, nextLabel: "", verifyCode: "", busy: false },
  onShow() { this.load(); this.timer = setInterval(() => this.load(true), 4000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  async load(quiet) { try { const data = await api.bootstrap("merchant"); const order = data.latestOrder; this.setData({ authorized: data.merchantAuthorized !== false, order, products: data.products, slots: data.slots, total: order ? money(order.totalCents) : "0", nextStatus: order ? nextStatus[order.status] || null : null, nextLabel: order ? nextLabel[order.status] || "" : "", loading: false }); } catch (error) { if (!quiet) wx.showToast({ title: error.message || "加载失败", icon: "none" }); } },
  tab(event) { this.setData({ tab: event.currentTarget.dataset.tab }); },
  inputCode(event) { this.setData({ verifyCode: event.detail.value }); },
  async advance() { if (!this.data.order || !this.data.nextStatus) return; await this.transition(this.data.nextStatus); },
  async verify() { await this.transition("completed", this.data.verifyCode); },
  async transition(status, pickupCode) { this.setData({ busy: true }); try { const order = await api.transitionOrder(this.data.order.id, status, pickupCode); this.setData({ order, nextStatus: nextStatus[order.status] || null, nextLabel: nextLabel[order.status] || "", verifyCode: "" }); wx.showToast({ title: order.statusLabel }); } catch (error) { wx.showToast({ title: error.message || "操作失败", icon: "none" }); } finally { this.setData({ busy: false }); } },
  async toggle(event) { const product = this.data.products.find((item) => item.id === Number(event.currentTarget.dataset.id)); if (!product) return; this.setData({ busy: true }); try { await api.setProductAvailability(product.id, !product.isSoldOut); await this.load(true); wx.showToast({ title: product.isSoldOut ? "已恢复销售" : "已同步售罄" }); } catch (error) { wx.showToast({ title: error.message || "操作失败", icon: "none" }); } finally { this.setData({ busy: false }); } }
});
