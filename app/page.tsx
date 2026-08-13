"use client";

import { useMemo, useState } from "react";

type Mode = "yinbao" | "youzan";
type Fulfillment = "pickup" | "delivery";
type Nav = "home" | "menu" | "orders" | "profile";

type Product = {
  id: number;
  name: string;
  subtitle: string;
  category: string;
  price: number;
  memberPrice: number;
  stock: number;
  tag?: string;
  image: string;
};

const PRODUCTS: Product[] = [
  {
    id: 1,
    name: "发酵黄油可颂",
    subtitle: "法国黄油 · 27 层酥脆",
    category: "今日现烤",
    price: 16,
    memberPrice: 14.5,
    stock: 8,
    tag: "热销 No.1",
    image:
      "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=86",
  },
  {
    id: 2,
    name: "伯爵柑橘贝果",
    subtitle: "佛手柑茶香 · 低糖",
    category: "今日现烤",
    price: 18,
    memberPrice: 16,
    stock: 5,
    tag: "新品",
    image:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=86",
  },
  {
    id: 3,
    name: "酸种乡村面包",
    subtitle: "天然酵母 · 18 小时慢发酵",
    category: "欧包吐司",
    price: 32,
    memberPrice: 29,
    stock: 3,
    tag: "主厨推荐",
    image:
      "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=86",
  },
  {
    id: 4,
    name: "肉桂苹果卷",
    subtitle: "焦糖苹果 · 锡兰肉桂",
    category: "甜点",
    price: 24,
    memberPrice: 21,
    stock: 6,
    tag: "秋日限定",
    image:
      "https://images.unsplash.com/photo-1598373182133-52452f7691ef?auto=format&fit=crop&w=900&q=86",
  },
  {
    id: 5,
    name: "火腿芝士恰巴塔",
    subtitle: "帕尔玛火腿 · 芝麻菜",
    category: "咸味轻食",
    price: 28,
    memberPrice: 25,
    stock: 4,
    tag: "午餐推荐",
    image:
      "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=86",
  },
  {
    id: 6,
    name: "海盐奶油卷",
    subtitle: "海盐黄油芯 · 柔软拉丝",
    category: "今日现烤",
    price: 12,
    memberPrice: 10.5,
    stock: 12,
    tag: "第二件 8 折",
    image:
      "https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=86",
  },
];

const CATEGORIES = ["全部", "今日现烤", "欧包吐司", "咸味轻食", "甜点"];

function money(value: number) {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("yinbao");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [category, setCategory] = useState("全部");
  const [nav, setNav] = useState<Nav>("menu");
  const [cart, setCart] = useState<Record<number, number>>({ 1: 1 });
  const [sheet, setSheet] = useState<"cart" | "checkout" | "success" | null>(
    null,
  );
  const [toast, setToast] = useState("已为你保留 10 分钟库存");

  const visibleProducts =
    category === "全部"
      ? PRODUCTS
      : PRODUCTS.filter((product) => product.category === category);

  const cartLines = PRODUCTS.filter((product) => cart[product.id]).map(
    (product) => ({ ...product, qty: cart[product.id] }),
  );
  const itemCount = cartLines.reduce((sum, line) => sum + line.qty, 0);
  const productTotal = cartLines.reduce(
    (sum, line) => sum + line.price * line.qty,
    0,
  );
  const deliveryFee = fulfillment === "delivery" ? 6 : 0;
  const discount = mode === "youzan" && productTotal >= 50 ? 8 : 0;
  const finalTotal = productTotal + deliveryFee - discount;

  const add = (id: number) => {
    setCart((current) => ({ ...current, [id]: (current[id] || 0) + 1 }));
    setToast("已加入购物袋");
    window.setTimeout(() => setToast(""), 1600);
  };

  const remove = (id: number) => {
    setCart((current) => {
      const next = { ...current };
      const qty = (next[id] || 0) - 1;
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setNav(next === "yinbao" ? "menu" : "home");
    setCategory("全部");
    setSheet(null);
    setToast(next === "yinbao" ? "效率版：更快完成点单" : "品牌版：先感受，再下单");
    window.setTimeout(() => setToast(""), 1800);
  };

  const selectFulfillment = (next: Fulfillment) => {
    setFulfillment(next);
    setToast(next === "pickup" ? "已切换：到店自提" : "已切换：同城配送");
    window.setTimeout(() => setToast(""), 1600);
  };

  return (
    <main className={`demo-site theme-${mode}`}>
      <header className="compare-header">
        <a className="studio-brand" href="#top" aria-label="麦屿面包 Demo 首页">
          <span className="studio-mark">M</span>
          <span>
            <b>麦屿面包 · 双路线 Demo</b>
            <small>同一套商品，体验两种经营思路</small>
          </span>
        </a>
        <div className="mode-switch" role="tablist" aria-label="选择 Demo 版本">
          <button
            className={mode === "yinbao" ? "active" : ""}
            onClick={() => changeMode("yinbao")}
            role="tab"
            aria-selected={mode === "yinbao"}
          >
            <span className="mode-dot orange" />
            银豹路线
            <small>效率点单</small>
          </button>
          <button
            className={mode === "youzan" ? "active" : ""}
            onClick={() => changeMode("youzan")}
            role="tab"
            aria-selected={mode === "youzan"}
          >
            <span className="mode-dot green" />
            有赞路线
            <small>品牌经营</small>
          </button>
        </div>
        <span className="prototype-pill">可点击原型</span>
      </header>

      <section className="showcase" id="top">
        <aside className="strategy-panel">
          <p className="eyebrow">CONCEPT {mode === "yinbao" ? "01" : "02"}</p>
          <h1>
            {mode === "yinbao" ? (
              <>
                少一步等待，
                <br />多一炉新鲜。
              </>
            ) : (
              <>
                先喜欢这家店，
                <br />再带走一袋香气。
              </>
            )}
          </h1>
          <p className="strategy-copy">
            {mode === "yinbao"
              ? "把余量、时间和取餐方式放在最前面，顾客进入后 30 秒内就能开始点单。适合开业初期和高峰出单。"
              : "用品牌内容、会员权益和主题商品建立记忆。适合重视复购、客单价与长期私域经营的门店。"}
          </p>
          <div className="strategy-tags">
            {(mode === "yinbao"
              ? ["现货优先", "10 分钟时段", "快速加购", "生产友好"]
              : ["品牌首屏", "会员价格", "主题内容", "精细营销"]
            ).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <div className="route-score">
            <div>
              <small>首发适配度</small>
              <strong>{mode === "yinbao" ? "9.2" : "8.7"}</strong>
            </div>
            <div className="score-bars" aria-label="路线特性评分">
              <span style={{ width: mode === "yinbao" ? "92%" : "76%" }} />
              <span style={{ width: mode === "yinbao" ? "72%" : "94%" }} />
              <small>出单效率　　品牌表达</small>
            </div>
          </div>
          <p className="demo-note">
            Demo 为产品概念演示，与银豹、有赞官方产品无隶属关系。
          </p>
        </aside>

        <div className="phone-stage">
          <div className="phone-shadow" />
          <div className="phone-shell">
            <div className="phone-status">
              <span>9:41</span>
              <span className="phone-island" />
              <span>5G　▰</span>
            </div>
            <div className="mini-app">
              {mode === "yinbao" ? (
                <YinbaoDemo
                  nav={nav}
                  setNav={setNav}
                  fulfillment={fulfillment}
                  selectFulfillment={selectFulfillment}
                  category={category}
                  setCategory={setCategory}
                  products={visibleProducts}
                  cart={cart}
                  add={add}
                  remove={remove}
                  itemCount={itemCount}
                  total={productTotal}
                  openCart={() => setSheet("cart")}
                />
              ) : (
                <YouzanDemo
                  nav={nav}
                  setNav={setNav}
                  fulfillment={fulfillment}
                  selectFulfillment={selectFulfillment}
                  category={category}
                  setCategory={setCategory}
                  products={visibleProducts}
                  cart={cart}
                  add={add}
                  remove={remove}
                  itemCount={itemCount}
                  total={productTotal}
                  openCart={() => setSheet("cart")}
                />
              )}
            </div>
            <div className="home-indicator" />
          </div>
        </div>

        <aside className="feature-rail">
          <p>本页可操作</p>
          <Feature index="01" title="切换履约" text="体验自提与配送费用变化" />
          <Feature index="02" title="选择商品" text="加购、减购与库存提示" />
          <Feature index="03" title="完成下单" text="查看购物袋与模拟支付" />
          <Feature index="04" title="查看订单" text="付款后进入履约进度" />
        </aside>
      </section>

      <footer className="site-footer">
        <span>麦屿面包产品原型 · 2026</span>
        <span>商品图片来自 Unsplash，仅用于 Demo 展示</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {sheet && (
        <OrderSheet
          step={sheet}
          close={() => setSheet(null)}
          cartLines={cartLines}
          add={add}
          remove={remove}
          fulfillment={fulfillment}
          selectFulfillment={selectFulfillment}
          productTotal={productTotal}
          deliveryFee={deliveryFee}
          discount={discount}
          finalTotal={finalTotal}
          checkout={() => setSheet("checkout")}
          pay={() => setSheet("success")}
          viewOrder={() => {
            setSheet(null);
            setNav("orders");
          }}
          mode={mode}
        />
      )}
    </main>
  );
}

function Feature({ index, title, text }: { index: string; title: string; text: string }) {
  return (
    <div className="feature-item">
      <span>{index}</span>
      <div>
        <b>{title}</b>
        <small>{text}</small>
      </div>
    </div>
  );
}

type DemoProps = {
  nav: Nav;
  setNav: (nav: Nav) => void;
  fulfillment: Fulfillment;
  selectFulfillment: (value: Fulfillment) => void;
  category: string;
  setCategory: (value: string) => void;
  products: Product[];
  cart: Record<number, number>;
  add: (id: number) => void;
  remove: (id: number) => void;
  itemCount: number;
  total: number;
  openCart: () => void;
};

function YinbaoDemo(props: DemoProps) {
  const {
    nav,
    setNav,
    fulfillment,
    selectFulfillment,
    category,
    setCategory,
    products,
    cart,
    add,
    remove,
    itemCount,
    total,
    openCart,
  } = props;

  return (
    <div className="yb-app">
      <div className="yb-header">
        <div className="yb-title-row">
          <div>
            <p>麦屿面包 · 南山店 <span>⌄</span></p>
            <small><i /> 营业中 · 21:30 打烊</small>
          </div>
          <button aria-label="更多">•••</button>
        </div>
        <div className="fulfillment-switch compact">
          <button
            className={fulfillment === "pickup" ? "active" : ""}
            onClick={() => selectFulfillment("pickup")}
          >
            到店自提
          </button>
          <button
            className={fulfillment === "delivery" ? "active" : ""}
            onClick={() => selectFulfillment("delivery")}
          >
            同城配送
          </button>
        </div>
        <button className="time-card" onClick={() => selectFulfillment(fulfillment)}>
          <span>最快{fulfillment === "pickup" ? "取货" : "送达"}</span>
          <b>{fulfillment === "pickup" ? "今天 15:40" : "今天 16:10"}</b>
          <em>可预约 ⌄</em>
        </button>
      </div>

      <div className="yb-body">
        {nav === "orders" ? (
          <OrdersPanel mode="yinbao" />
        ) : nav === "profile" ? (
          <ProfilePanel mode="yinbao" />
        ) : (
          <>
            <div className="yb-notice"><span>新鲜提示</span> 下午第二炉可颂 15:30 出炉</div>
            <div className="yb-menu-layout">
              <nav className="yb-categories" aria-label="商品分类">
                {CATEGORIES.map((item) => (
                  <button
                    key={item}
                    className={category === item ? "active" : ""}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </nav>
              <div className="yb-products">
                <div className="section-heading">
                  <div>
                    <b>{category === "全部" ? "今日推荐" : category}</b>
                    <small>当日制作 · 售完即止</small>
                  </div>
                  <span>共 {products.length} 款</span>
                </div>
                {products.map((product) => (
                  <article className="yb-product" key={product.id}>
                    <div className="product-photo-wrap">
                      <img src={product.image} alt={product.name} />
                      {product.tag && <span>{product.tag}</span>}
                    </div>
                    <div className="yb-product-info">
                      <h3>{product.name}</h3>
                      <p>{product.subtitle}</p>
                      <small className={product.stock <= 3 ? "low" : ""}>
                        {product.stock <= 3 ? `仅剩 ${product.stock} 份` : `今日余量 ${product.stock}`}
                      </small>
                      <div className="price-action">
                        <b><i>¥</i>{product.price}</b>
                        {cart[product.id] ? (
                          <div className="stepper">
                            <button onClick={() => remove(product.id)} aria-label={`减少${product.name}`}>−</button>
                            <span>{cart[product.id]}</span>
                            <button onClick={() => add(product.id)} aria-label={`增加${product.name}`}>＋</button>
                          </div>
                        ) : (
                          <button className="round-add" onClick={() => add(product.id)} aria-label={`加入${product.name}`}>＋</button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {itemCount > 0 && nav !== "orders" && nav !== "profile" && (
        <button className="cart-bar yb-cart" onClick={openCart}>
          <span className="bag-icon">▱<i>{itemCount}</i></span>
          <span><small>已选 {itemCount} 件</small><b>¥{money(total)}</b></span>
          <strong>去结算</strong>
        </button>
      )}
      <BottomNav nav={nav} setNav={setNav} mode="yinbao" />
    </div>
  );
}

function YouzanDemo(props: DemoProps) {
  const {
    nav,
    setNav,
    fulfillment,
    selectFulfillment,
    category,
    setCategory,
    products,
    cart,
    add,
    remove,
    itemCount,
    total,
    openCart,
  } = props;

  const featuredProducts = category === "全部" ? products.slice(0, 4) : products;

  return (
    <div className="yz-app">
      <div className="yz-topbar">
        <span>麦屿 BAKEHOUSE</span>
        <button aria-label="更多">•••　◎</button>
      </div>
      <div className="yz-scroll">
        {nav === "orders" ? (
          <OrdersPanel mode="youzan" />
        ) : nav === "profile" ? (
          <ProfilePanel mode="youzan" />
        ) : nav === "menu" ? (
          <div className="yz-menu-page">
            <div className="yz-menu-title">
              <p>ONLINE ORDER</p>
              <h2>今天，想吃点什么？</h2>
            </div>
            <div className="fulfillment-switch soft">
              <button className={fulfillment === "pickup" ? "active" : ""} onClick={() => selectFulfillment("pickup")}>到店自提 · 15:40</button>
              <button className={fulfillment === "delivery" ? "active" : ""} onClick={() => selectFulfillment("delivery")}>同城配送 · 16:10</button>
            </div>
            <div className="yz-chip-row">
              {CATEGORIES.map((item) => (
                <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>
              ))}
            </div>
            <div className="yz-grid menu-grid">
              {products.map((product) => (
                <YzProduct key={product.id} product={product} qty={cart[product.id] || 0} add={add} remove={remove} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <section className="yz-hero">
              <img src={PRODUCTS[2].image} alt="天然酵母酸种面包" />
              <div className="yz-hero-overlay">
                <p>A SLOWER WAY TO BAKE</p>
                <h2>把时间，<br />烤进面包里。</h2>
                <button onClick={() => setNav("menu")}>开始点单 <span>→</span></button>
              </div>
            </section>
            <section className="member-card">
              <span className="member-seal">M</span>
              <div><small>MAIYU MEMBER</small><b>新会员立减 8 元</b></div>
              <button onClick={() => setNav("profile")}>立即加入</button>
            </section>
            <section className="yz-section">
              <div className="yz-section-title">
                <div><small>BAKER'S CHOICE</small><h3>今日出炉</h3></div>
                <button onClick={() => setNav("menu")}>查看全部 →</button>
              </div>
              <div className="yz-grid">
                {featuredProducts.map((product) => (
                  <YzProduct key={product.id} product={product} qty={cart[product.id] || 0} add={add} remove={remove} />
                ))}
              </div>
            </section>
            <section className="story-card">
              <p>FROM OUR OVEN</p>
              <h3>每日两炉，<br />跟着麦香来取面包。</h3>
              <div><span>上午炉 09:30</span><span>下午炉 15:30</span></div>
            </section>
          </>
        )}
      </div>
      {itemCount > 0 && nav !== "orders" && nav !== "profile" && (
        <button className="cart-bar yz-cart" onClick={openCart}>
          <span className="bag-icon">▱<i>{itemCount}</i></span>
          <span><small>购物袋 · {itemCount} 件</small><b>¥{money(total)}</b></span>
          <strong>去结算</strong>
        </button>
      )}
      <BottomNav nav={nav} setNav={setNav} mode="youzan" />
    </div>
  );
}

function YzProduct({
  product,
  qty,
  add,
  remove,
}: {
  product: Product;
  qty: number;
  add: (id: number) => void;
  remove: (id: number) => void;
}) {
  return (
    <article className="yz-product">
      <div className="yz-photo">
        <img src={product.image} alt={product.name} />
        {product.tag && <span>{product.tag}</span>}
        <button onClick={() => add(product.id)} aria-label={`收藏${product.name}`}>♡</button>
      </div>
      <div className="yz-product-copy">
        <h3>{product.name}</h3>
        <p>{product.subtitle}</p>
        <div className="member-price"><small>会员价</small><b>¥{money(product.memberPrice)}</b><del>¥{product.price}</del></div>
        {qty ? (
          <div className="stepper yz-stepper">
            <button onClick={() => remove(product.id)} aria-label={`减少${product.name}`}>−</button>
            <span>{qty}</span>
            <button onClick={() => add(product.id)} aria-label={`增加${product.name}`}>＋</button>
          </div>
        ) : (
          <button className="yz-add" onClick={() => add(product.id)}>加入</button>
        )}
      </div>
    </article>
  );
}

function BottomNav({ nav, setNav, mode }: { nav: Nav; setNav: (nav: Nav) => void; mode: Mode }) {
  const items: { id: Nav; icon: string; label: string }[] = [
    { id: "home", icon: "⌂", label: "首页" },
    { id: "menu", icon: "▦", label: "点单" },
    { id: "orders", icon: "▤", label: "订单" },
    { id: "profile", icon: "◉", label: "我的" },
  ];
  return (
    <nav className={`bottom-nav ${mode}`} aria-label="小程序主导航">
      {items.map((item) => (
        <button key={item.id} className={nav === item.id ? "active" : ""} onClick={() => setNav(item.id)}>
          <span>{item.icon}</span><small>{item.label}</small>
        </button>
      ))}
    </nav>
  );
}

function OrdersPanel({ mode }: { mode: Mode }) {
  return (
    <div className={`orders-panel ${mode}`}>
      <div className="page-title"><small>MY ORDERS</small><h2>我的订单</h2></div>
      <div className="order-tabs"><button className="active">进行中</button><button>已完成</button><button>退款/售后</button></div>
      <article className="active-order">
        <div className="order-top"><span>到店自提 · #A082</span><b>制作中</b></div>
        <div className="progress-track"><i /><i className="active" /><i /><i /></div>
        <div className="progress-label"><span>已支付</span><span>制作中</span><span>待取货</span><span>已完成</span></div>
        <div className="order-products">
          <img src={PRODUCTS[0].image} alt="可颂" />
          <img src={PRODUCTS[3].image} alt="肉桂卷" />
          <div><b>发酵黄油可颂等 2 件</b><small>预计 15:40 可取</small></div>
          <strong>¥40</strong>
        </div>
        <div className="pickup-code"><span>取餐码</span><b>A0 82</b><small>请到店后向店员出示</small></div>
        <div className="order-actions"><button>联系门店</button><button className="primary">查看详情</button></div>
      </article>
      <div className="empty-history"><span>◷</span><p>完成订单后，可以在这里一键复购</p></div>
    </div>
  );
}

function ProfilePanel({ mode }: { mode: Mode }) {
  return (
    <div className={`profile-panel ${mode}`}>
      <div className="profile-hero">
        <div className="avatar">麦</div>
        <div><h2>下午好，面包朋友</h2><p>{mode === "youzan" ? "麦屿会员 · 麦穗 120" : "登录后同步会员与订单"}</p></div>
      </div>
      {mode === "youzan" && (
        <div className="loyalty-card"><small>MAIYU MEMBER</small><b>本月再消费 ¥58 升级银穗会员</b><div><i style={{ width: "68%" }} /></div><span>¥142 / ¥200</span></div>
      )}
      <div className="profile-stats"><div><b>3</b><small>优惠券</small></div><div><b>120</b><small>麦穗积分</small></div><div><b>2</b><small>收藏</small></div></div>
      <div className="profile-menu">
        <button><span>▱</span><b>收货地址</b><i>›</i></button>
        <button><span>♧</span><b>过敏原偏好</b><i>›</i></button>
        <button><span>♙</span><b>联系客服</b><i>›</i></button>
        <button><span>ⓘ</span><b>门店与资质</b><i>›</i></button>
      </div>
    </div>
  );
}

type SheetProps = {
  step: "cart" | "checkout" | "success";
  close: () => void;
  cartLines: Array<Product & { qty: number }>;
  add: (id: number) => void;
  remove: (id: number) => void;
  fulfillment: Fulfillment;
  selectFulfillment: (value: Fulfillment) => void;
  productTotal: number;
  deliveryFee: number;
  discount: number;
  finalTotal: number;
  checkout: () => void;
  pay: () => void;
  viewOrder: () => void;
  mode: Mode;
};

function OrderSheet(props: SheetProps) {
  const {
    step,
    close,
    cartLines,
    add,
    remove,
    fulfillment,
    selectFulfillment,
    productTotal,
    deliveryFee,
    discount,
    finalTotal,
    checkout,
    pay,
    viewOrder,
    mode,
  } = props;

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className={`order-sheet ${mode}`} role="dialog" aria-modal="true" aria-label={step === "cart" ? "购物袋" : "确认订单"}>
        <div className="sheet-grabber" />
        {step === "success" ? (
          <div className="success-panel">
            <div className="success-mark">✓</div>
            <p>PAYMENT SUCCESS</p>
            <h2>支付成功</h2>
            <span>门店已收到订单，预计 15:40 可取</span>
            <div className="success-code"><small>取餐码</small><b>A0 82</b></div>
            <button className="main-action" onClick={viewOrder}>查看订单进度</button>
            <button className="text-action" onClick={close}>继续逛逛</button>
          </div>
        ) : step === "cart" ? (
          <>
            <div className="sheet-title"><div><small>YOUR BAG</small><h2>购物袋</h2></div><button onClick={close}>×</button></div>
            <div className="sheet-lines">
              {cartLines.map((line) => (
                <div className="sheet-line" key={line.id}>
                  <img src={line.image} alt={line.name} />
                  <div><b>{line.name}</b><small>{line.subtitle}</small><strong>¥{line.price}</strong></div>
                  <div className="stepper"><button onClick={() => remove(line.id)}>−</button><span>{line.qty}</span><button onClick={() => add(line.id)}>＋</button></div>
                </div>
              ))}
            </div>
            <div className="fulfillment-switch sheet-switch">
              <button className={fulfillment === "pickup" ? "active" : ""} onClick={() => selectFulfillment("pickup")}>到店自提</button>
              <button className={fulfillment === "delivery" ? "active" : ""} onClick={() => selectFulfillment("delivery")}>同城配送</button>
            </div>
            <div className="bill-row"><span>商品小计</span><b>¥{money(productTotal)}</b></div>
            {discount > 0 && <div className="bill-row discount"><span>新会员满 ¥50 减</span><b>−¥{discount}</b></div>}
            <div className="sheet-total"><span>合计</span><b>¥{money(productTotal - discount)}</b></div>
            <button className="main-action" disabled={!cartLines.length} onClick={checkout}>确认商品，去结算</button>
          </>
        ) : (
          <>
            <div className="sheet-title"><button className="back" onClick={checkout}>‹</button><div><small>CHECKOUT</small><h2>确认订单</h2></div><button onClick={close}>×</button></div>
            <button className="checkout-card">
              <span>{fulfillment === "pickup" ? "⌖" : "⌂"}</span>
              <div><small>{fulfillment === "pickup" ? "到店自提" : "配送地址"}</small><b>{fulfillment === "pickup" ? "麦屿面包 · 南山店" : "科苑南路 2666 号 · 张女士"}</b><p>{fulfillment === "pickup" ? "深圳市南山区海德三道 18 号" : "138 **** 0826"}</p></div><i>›</i>
            </button>
            <button className="checkout-card time-select"><span>◷</span><div><small>{fulfillment === "pickup" ? "取货时间" : "送达时间"}</small><b>{fulfillment === "pickup" ? "今天 15:40–15:50" : "今天 16:10–16:30"}</b></div><i>›</i></button>
            <div className="checkout-summary">
              <div>{cartLines.slice(0, 3).map((line) => <img key={line.id} src={line.image} alt={line.name} />)}</div>
              <span>共 {cartLines.reduce((sum, line) => sum + line.qty, 0)} 件</span>
              <b>¥{money(productTotal)}</b>
            </div>
            <div className="bill-row"><span>商品金额</span><b>¥{money(productTotal)}</b></div>
            {deliveryFee > 0 && <div className="bill-row"><span>配送费</span><b>¥{deliveryFee}</b></div>}
            {discount > 0 && <div className="bill-row discount"><span>优惠券</span><b>−¥{discount}</b></div>}
            <div className="sheet-total"><span>应付</span><b>¥{money(finalTotal)}</b></div>
            <button className="main-action pay-button" onClick={pay}><span>微信支付</span><b>¥{money(finalTotal)}</b></button>
            <p className="agreement">提交即表示同意《用户协议》《退款规则》</p>
          </>
        )}
      </section>
    </div>
  );
}
