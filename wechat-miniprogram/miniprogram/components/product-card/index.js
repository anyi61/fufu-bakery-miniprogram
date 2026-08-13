const { money } = require("../../utils/format");
Component({
  properties: { product: Object, quantity: { type: Number, value: 0 } },
  data: { price: "0" },
  observers: { "product.priceCents": function (value) { this.setData({ price: money(value) }); } },
  methods: {
    add() { if (!this.data.product.isSoldOut && this.data.product.availableStock > 0) this.triggerEvent("add", { product: this.data.product }); },
    remove() { this.triggerEvent("remove", { productId: this.data.product.id }); }
  }
});
