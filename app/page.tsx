"use client";

import { useMemo, useState } from "react";

type Surface = "customer" | "merchant";
type CustomerPage = "menu" | "orders" | "profile";
type MerchantPage = "orders" | "production" | "inventory";
type OrderStatus = "待接单" | "已接单" | "制作中" | "待取货" | "已完成";

type Product = {
  id: number;
  name: string;
  subtitle: string;
  category: string;
  price: number;
  stock: number;
  tag?: string;
  image: string;
};

const PRODUCTS: Product[] = [
  { id: 1, name: "发酵黄油可颂", subtitle: "法国黄油 · 27 层酥脆", category: "今日现烤", price: 16, stock: 8, tag: "热销 No.1", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=86" },
  { id: 2, name: "伯爵柑橘贝果", subtitle: "佛手柑茶香 · 低糖", category: "今日现烤", price: 18, stock: 5, tag: "新品", image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=86" },
  { id: 3, name: "酸种乡村面包", subtitle: "天然酵母 · 18 小时慢发酵", category: "欧包吐司", price: 32, stock: 3, tag: "主厨推荐", image: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=900&q=86" },
  { id: 4, name: "肉桂苹果卷", subtitle: "焦糖苹果 · 锡兰肉桂", category: "甜点", price: 24, stock: 6, tag: "秋日限定", image: "https://images.unsplash.com/photo-1598373182133-52452f7691ef?auto=format&fit=crop&w=900&q=86" },
  { id: 5, name: "火腿芝士恰巴塔", subtitle: "帕尔玛火腿 · 芝麻菜", category: "咸味轻食", price: 28, stock: 4, tag: "午餐推荐", image: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=86" },
  { id: 6, name: "海盐奶油卷", subtitle: "海盐黄油芯 · 柔软拉丝", category: "今日现烤", price: 12, stock: 12, tag: "第二件 8 折", image: "https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=900&q=86" },
];

const CATEGORIES = ["全部", "今日现烤", "欧包吐司", "咸味轻食", "甜点"];
const SLOTS = [
  { time: "15:40–15:50", left: 6 },
  { time: "16:00–16:10", left: 8 },
  { time: "16:20–16:30", left: 3 },
];
const ORDER_FLOW: OrderStatus[] = ["待接单", "已接单", "制作中", "待取货", "已完成"];

function money(value: number) {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

export default function Home() {
  const [surface, setSurface] = useState<Surface>("customer");
  const [customerPage, setCustomerPage] = useState<CustomerPage>("menu");
  const [merchantPage, setMerchantPage] = useState<MerchantPage>("orders");
  const [category, setCategory] = useState("全部");
  const [slot, setSlot] = useState(0);
  const [cart, setCart] = useState<Record<number, number>>({ 1: 1 });
  const [checkout, setCheckout] = useState<"bag" | "confirm" | "success" | null>(null);
  const [orderCreated, setOrderCreated] = useState(false);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>("待接单");
  const [verifyCode, setVerifyCode] = useState("");
  const [toast, setToast] = useState("");
  const [soldOut, setSoldOut] = useState<number[]>([]);

  const products = category === "全部" ? PRODUCTS : PRODUCTS.filter((item) => item.category === category);
  const cartLines = PRODUCTS.filter((item) => cart[item.id]).map((item) => ({ ...item, qty: cart[item.id] }));
  const count = cartLines.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartLines.reduce((sum, item) => sum + item.price * item.qty, 0);
  const packageFee = count > 0 ? 2 : 0;
  const total = subtotal + packageFee;

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  };

  const add = (id: number) => {
    if (soldOut.includes(id)) return notify("该商品已临时售罄");
    const product = PRODUCTS.find((item) => item.id === id)!;
    if ((cart[id] || 0) >= product.stock) return notify("已达到今日可售余量");
    setCart((current) => ({ ...current, [id]: (current[id] || 0) + 1 }));
    notify("已加入购物袋");
  };

  const remove = (id: number) => {
    setCart((current) => {
      const next = { ...current };
      if ((next[id] || 0) <= 1) delete next[id];
      else next[id] -= 1;
      return next;
    });
  };

  const pay = () => {
    setOrderCreated(true);
    setOrderStatus("待接单");
    setCheckout("success");
  };

  const advanceOrder = () => {
    const index = ORDER_FLOW.indexOf(orderStatus);
    if (index < ORDER_FLOW.length - 1) {
      const next = ORDER_FLOW[index + 1];
      setOrderStatus(next);
      notify(`订单已更新为“${next}”`);
    }
  };

  const verify = () => {
    if (verifyCode.replace(/\s/g, "").toUpperCase() !== "A082") return notify("取餐码不正确，请核对后重试");
    setOrderStatus("已完成");
    setVerifyCode("");
    notify("核销成功，订单已完成");
  };

  return (
    <main className="xy-site">
      <header className="xy-header">
        <button className="xy-brand" onClick={() => setSurface("customer")} aria-label="小雨面包顾客端">
          <span className="rain-mark"><i /><i /><i /></span>
          <span><b>小雨面包</b><small>XIAOYU BAKEHOUSE</small></span>
        </button>
        <nav className="surface-switch" aria-label="演示端切换">
          <button className={surface === "customer" ? "active" : ""} onClick={() => setSurface("customer")}><span>◉</span> 顾客小程序</button>
          <button className={surface === "merchant" ? "active" : ""} onClick={() => setSurface("merchant")}><span>▦</span> 门店工作台 {orderCreated && orderStatus === "待接单" && <i>1</i>}</button>
        </nav>
        <div className="header-meta"><span className="online-dot" /> 初版功能 Demo</div>
      </header>

      {surface === "customer" ? (
        <CustomerSurface
          page={customerPage}
          setPage={setCustomerPage}
          category={category}
          setCategory={setCategory}
          products={products}
          cart={cart}
          add={add}
          remove={remove}
          count={count}
          subtotal={subtotal}
          slot={slot}
          setSlot={setSlot}
          openBag={() => setCheckout("bag")}
          orderCreated={orderCreated}
          orderStatus={orderStatus}
          soldOut={soldOut}
        />
      ) : (
        <MerchantSurface
          page={merchantPage}
          setPage={setMerchantPage}
          orderCreated={orderCreated}
          orderStatus={orderStatus}
          advanceOrder={advanceOrder}
          cartLines={cartLines}
          total={total}
          slot={slot}
          verifyCode={verifyCode}
          setVerifyCode={setVerifyCode}
          verify={verify}
          soldOut={soldOut}
          toggleSoldOut={(id) => setSoldOut((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
        />
      )}

      {checkout && (
        <CheckoutSheet
          step={checkout}
          close={() => setCheckout(null)}
          lines={cartLines}
          add={add}
          remove={remove}
          count={count}
          subtotal={subtotal}
          packageFee={packageFee}
          total={total}
          slot={slot}
          setSlot={setSlot}
          next={() => setCheckout("confirm")}
          pay={pay}
          viewOrder={() => { setCheckout(null); setCustomerPage("orders"); }}
          goMerchant={() => { setCheckout(null); setSurface("merchant"); }}
        />
      )}
      {toast && <div className="xy-toast">{toast}</div>}
    </main>
  );
}

type CustomerProps = {
  page: CustomerPage;
  setPage: (page: CustomerPage) => void;
  category: string;
  setCategory: (category: string) => void;
  products: Product[];
  cart: Record<number, number>;
  add: (id: number) => void;
  remove: (id: number) => void;
  count: number;
  subtotal: number;
  slot: number;
  setSlot: (slot: number) => void;
  openBag: () => void;
  orderCreated: boolean;
  orderStatus: OrderStatus;
  soldOut: number[];
};

function CustomerSurface(props: CustomerProps) {
  return (
    <section className="customer-stage">
      <aside className="customer-intro">
        <p className="overline">CUSTOMER EXPERIENCE · V0.1</p>
        <h1>今天出炉，<br />今天带走。</h1>
        <p>小雨面包首发只做预约到店自提。顾客先确认余量与取货时间，再完成支付，门店按时段集中生产。</p>
        <div className="promise-list">
          <span><i>01</i><b>余量真实</b><small>售完即止，支付前再次校验</small></span>
          <span><i>02</i><b>时间明确</b><small>每 10 分钟一个自提时段</small></span>
          <span><i>03</i><b>取货简单</b><small>出示 A082，店员一次核销</small></span>
        </div>
        <div className="scope-note"><b>本期范围</b><span>预约自提</span><span>微信支付</span><span>门店核销</span></div>
      </aside>

      <div className="phone-wrap">
        <div className="xy-phone">
          <div className="phone-status"><span>9:41</span><i /><span>5G　▰</span></div>
          <div className="customer-app">
            {props.page === "menu" && <CustomerMenu {...props} />}
            {props.page === "orders" && <CustomerOrders orderCreated={props.orderCreated} status={props.orderStatus} setPage={props.setPage} />}
            {props.page === "profile" && <CustomerProfile />}
            {props.count > 0 && props.page === "menu" && (
              <button className="floating-cart" onClick={props.openBag}><span className="cart-symbol">▱<i>{props.count}</i></span><span><small>已选 {props.count} 件</small><b>¥{money(props.subtotal)}</b></span><strong>去结算</strong></button>
            )}
            <nav className="customer-nav">
              <button className={props.page === "menu" ? "active" : ""} onClick={() => props.setPage("menu")}><span>▦</span><small>点单</small></button>
              <button className={props.page === "orders" ? "active" : ""} onClick={() => props.setPage("orders")}><span>▤</span><small>订单</small>{props.orderCreated && props.orderStatus !== "已完成" && <i />}</button>
              <button className={props.page === "profile" ? "active" : ""} onClick={() => props.setPage("profile")}><span>◉</span><small>我的</small></button>
            </nav>
          </div>
          <div className="home-bar" />
        </div>
      </div>

      <aside className="customer-guide">
        <p>建议体验路径</p>
        <ol><li><span>1</span>选择取货时段</li><li><span>2</span>添加两件商品</li><li><span>3</span>模拟微信支付</li><li><span>4</span>切换到门店工作台</li></ol>
        <div className="no-delivery"><span>✓</span><div><b>范围已收敛</b><small>没有配送入口、地址或配送费用</small></div></div>
      </aside>
    </section>
  );
}

function CustomerMenu(props: CustomerProps) {
  return (
    <div className="menu-page">
      <header className="mini-header">
        <div><p>小雨面包 <span>⌄</span></p><small><i /> 营业中 · 21:30 打烊</small></div><button>•••</button>
      </header>
      <div className="pickup-only"><span>到店自提</span><b>小雨面包 · 首店</b><small>门店地址待确认 ›</small></div>
      <button className="slot-summary" onClick={() => props.setSlot((props.slot + 1) % SLOTS.length)}><span>预约取货</span><b>今天 {SLOTS[props.slot].time}</b><em>余 {SLOTS[props.slot].left} 单可约　⌄</em></button>
      <div className="fresh-notice"><b>新鲜提示</b> 下午第二炉可颂 15:30 出炉</div>
      <div className="menu-columns">
        <nav className="category-nav">{CATEGORIES.map((item) => <button key={item} className={props.category === item ? "active" : ""} onClick={() => props.setCategory(item)}>{item}</button>)}</nav>
        <div className="product-list">
          <div className="list-title"><div><b>{props.category === "全部" ? "今日推荐" : props.category}</b><small>当日制作 · 售完即止</small></div><span>{props.products.length} 款</span></div>
          {props.products.map((product) => {
            const unavailable = props.soldOut.includes(product.id);
            const qty = props.cart[product.id] || 0;
            return <article className={`product-row ${unavailable ? "sold-out" : ""}`} key={product.id}>
              <div className="product-image"><img src={product.image} alt={product.name} />{product.tag && !unavailable && <span>{product.tag}</span>}{unavailable && <em>已售罄</em>}</div>
              <div className="product-copy"><h3>{product.name}</h3><p>{product.subtitle}</p><small className={product.stock <= 3 ? "low" : ""}>{unavailable ? "暂不可购买" : product.stock <= 3 ? `仅剩 ${product.stock} 份` : `今日余量 ${product.stock}`}</small><div><b><i>¥</i>{product.price}</b>{qty ? <div className="qty-step"><button onClick={() => props.remove(product.id)}>−</button><span>{qty}</span><button onClick={() => props.add(product.id)}>＋</button></div> : <button className="add-button" disabled={unavailable} onClick={() => props.add(product.id)}>＋</button>}</div></div>
            </article>;
          })}
        </div>
      </div>
    </div>
  );
}

function CustomerOrders({ orderCreated, status, setPage }: { orderCreated: boolean; status: OrderStatus; setPage: (page: CustomerPage) => void }) {
  const current = ORDER_FLOW.indexOf(status);
  if (!orderCreated) return <div className="empty-orders"><div>▤</div><h2>还没有订单</h2><p>挑几款今天出炉的面包吧</p><button onClick={() => setPage("menu")}>去点单</button></div>;
  return <div className="order-page"><header><small>MY ORDER</small><h2>我的订单</h2></header><article className="customer-order-card"><div className="order-card-top"><span>预约自提 · #XY082</span><b>{status}</b></div><div className="flow-line">{ORDER_FLOW.map((item, index) => <span key={item} className={index <= current ? "done" : ""}><i />{item}</span>)}</div><div className="order-goods"><img src={PRODUCTS[0].image} alt="发酵黄油可颂" /><img src={PRODUCTS[3].image} alt="肉桂苹果卷" /><div><b>发酵黄油可颂等</b><small>共 2 件 · ¥42</small></div></div><div className="pickup-code"><small>到店出示取餐码</small><b>A0 82</b><span>{status === "待取货" ? "面包已备妥，可以来取啦" : status === "已完成" ? "已于门店完成核销" : "预计今天 15:40 可取"}</span></div><div className="order-actions"><button>联系门店</button><button>订单详情</button></div></article></div>;
}

function CustomerProfile() {
  return <div className="profile-page"><div className="profile-head"><span>雨</span><div><h2>下午好，面包朋友</h2><p>登录后同步订单和优惠券</p></div></div><div className="profile-stats"><span><b>2</b><small>优惠券</small></span><span><b>0</b><small>积分</small></span><span><b>1</b><small>收藏</small></span></div><div className="profile-menu"><button><span>♧</span><b>常用取货人</b><i>›</i></button><button><span>♡</span><b>过敏原偏好</b><i>›</i></button><button><span>♙</span><b>联系客服</b><i>›</i></button><button><span>ⓘ</span><b>门店与资质</b><i>›</i></button></div></div>;
}

type MerchantProps = {
  page: MerchantPage;
  setPage: (page: MerchantPage) => void;
  orderCreated: boolean;
  orderStatus: OrderStatus;
  advanceOrder: () => void;
  cartLines: Array<Product & { qty: number }>;
  total: number;
  slot: number;
  verifyCode: string;
  setVerifyCode: (code: string) => void;
  verify: () => void;
  soldOut: number[];
  toggleSoldOut: (id: number) => void;
};

function MerchantSurface(props: MerchantProps) {
  return <section className="merchant-shell">
    <aside className="merchant-sidebar"><div className="merchant-logo"><span className="rain-mark small"><i /><i /><i /></span><div><b>小雨面包</b><small>门店工作台</small></div></div><nav><button className={props.page === "orders" ? "active" : ""} onClick={() => props.setPage("orders")}><span>▤</span>订单中心{props.orderCreated && props.orderStatus === "待接单" && <i>1</i>}</button><button className={props.page === "production" ? "active" : ""} onClick={() => props.setPage("production")}><span>♨</span>生产看板</button><button className={props.page === "inventory" ? "active" : ""} onClick={() => props.setPage("inventory")}><span>▦</span>今日库存</button></nav><div className="sidebar-bottom"><span className="online-dot" /> 小雨面包 · 首店<small>营业中 · 21:30 打烊</small></div></aside>
    <div className="merchant-main"><header className="merchant-top"><div><p>2026 年 8 月 13 日 · 星期四</p><h1>{props.page === "orders" ? "订单中心" : props.page === "production" ? "生产看板" : "今日库存"}</h1></div><div><button>⌕</button><button>⚙</button><span className="staff-avatar">店</span></div></header>
      {props.page === "orders" && <MerchantOrders {...props} />}
      {props.page === "production" && <ProductionBoard {...props} />}
      {props.page === "inventory" && <InventoryBoard soldOut={props.soldOut} toggleSoldOut={props.toggleSoldOut} />}
    </div>
  </section>;
}

function MerchantOrders(props: MerchantProps) {
  return <div className="merchant-content"><div className="kpi-row"><Kpi label="今日实收" value={`¥${props.orderCreated ? money(props.total + 824) : "824"}`} trend="较昨日 +12.4%" /><Kpi label="支付订单" value={props.orderCreated ? "19" : "18"} trend="自提订单 100%" /><Kpi label="待处理" value={props.orderCreated && props.orderStatus === "待接单" ? "1" : "0"} trend="请及时接单" alert={props.orderCreated && props.orderStatus === "待接单"} /><Kpi label="准时备妥率" value="96.8%" trend="目标 ≥ 95%" /></div><div className="order-toolbar"><div><button className="active">全部订单</button><button>待接单 {props.orderCreated && props.orderStatus === "待接单" && <i>1</i>}</button><button>制作中</button><button>待取货</button><button>已完成</button></div><div><button>筛选</button><button>导出</button></div></div>{props.orderCreated ? <article className="merchant-order"><div className="merchant-order-head"><div><span className="order-type">预约自提</span><b>#XY082</b><small>刚刚下单 · 取货 {SLOTS[props.slot].time}</small></div><strong className={`status status-${ORDER_FLOW.indexOf(props.orderStatus)}`}>{props.orderStatus}</strong></div><div className="merchant-order-grid"><div className="customer-cell"><small>取货人</small><b>张女士　138 **** 0826</b><span>备注：可颂请装纸袋</span></div><div className="goods-cell"><small>商品明细</small>{props.cartLines.map((line) => <span key={line.id}><b>{line.name}</b><i>× {line.qty}</i></span>)}</div><div className="amount-cell"><small>实付金额</small><b>¥{money(props.total)}</b><span>微信支付</span></div></div><div className="merchant-order-foot"><div><button>打印小票</button><button>联系顾客</button></div>{props.orderStatus === "待取货" ? <div className="verify-box"><input value={props.verifyCode} onChange={(event) => props.setVerifyCode(event.target.value)} placeholder="输入取餐码 A082" /><button onClick={props.verify}>核销取货</button></div> : props.orderStatus !== "已完成" ? <button className="primary-order-action" onClick={props.advanceOrder}>{props.orderStatus === "待接单" ? "接单并打印" : props.orderStatus === "已接单" ? "开始制作" : "标记已备妥"} →</button> : <span className="completed-check">✓ 已完成核销</span>}</div></article> : <div className="merchant-empty"><span>◎</span><h3>等待新订单</h3><p>请切换到顾客小程序完成一次下单</p></div>}<div className="order-flow-hint"><b>Demo 操作提示</b><span>顾客支付 → 门店接单 → 开始制作 → 标记备妥 → 输入 A082 核销</span></div></div>;
}

function Kpi({ label, value, trend, alert }: { label: string; value: string; trend: string; alert?: boolean }) {
  return <div className={`kpi-card ${alert ? "alert" : ""}`}><span>{label}</span><b>{value}</b><small>{trend}</small></div>;
}

function ProductionBoard(props: MerchantProps) {
  const quantities = useMemo(() => {
    const base = [{ ...PRODUCTS[0], qty: 12 }, { ...PRODUCTS[5], qty: 10 }, { ...PRODUCTS[2], qty: 4 }];
    if (!props.orderCreated || props.orderStatus === "已完成") return base;
    return base.map((item) => ({ ...item, qty: item.qty + (props.cartLines.find((line) => line.id === item.id)?.qty || 0) }));
  }, [props.orderCreated, props.orderStatus, props.cartLines]);
  return <div className="merchant-content"><div className="production-summary"><div><p>NEXT PICKUP WINDOW</p><h2>15:40–15:50</h2><span>距离取货窗口还有 38 分钟</span></div><div><b>{props.orderCreated && props.orderStatus !== "已完成" ? "7" : "6"}</b><small>待生产订单</small></div><div><b>26</b><small>待制作件数</small></div><button>打印生产单</button></div><div className="production-layout"><section><header><div><small>按商品汇总</small><h3>15:40 批次</h3></div><span>自动计入已支付订单</span></header>{quantities.map((item, index) => <article className="production-item" key={item.id}><span className="sequence">0{index + 1}</span><img src={item.image} alt={item.name} /><div><b>{item.name}</b><small>{item.subtitle}</small></div><strong>{item.qty}<small>份</small></strong><span className={index === 0 ? "making" : "waiting"}>{index === 0 ? "制作中" : "待制作"}</span></article>)}</section><aside><h3>时间段负载</h3>{SLOTS.map((item, index) => <div className="capacity-row" key={item.time}><span>{item.time}</span><div><i style={{ width: `${[72, 48, 83][index]}%` }} /></div><b>{[9, 6, 10][index]}/12</b></div>)}</aside></div></div>;
}

function InventoryBoard({ soldOut, toggleSoldOut }: { soldOut: number[]; toggleSoldOut: (id: number) => void }) {
  return <div className="merchant-content"><div className="inventory-head"><div><p>2026-08-13 · 今日可售</p><h2>库存与售罄管理</h2></div><button>＋ 批量调整库存</button></div><div className="inventory-table"><div className="inventory-table-head"><span>商品</span><span>计划量</span><span>已售</span><span>剩余</span><span>销售状态</span><span>操作</span></div>{PRODUCTS.map((item, index) => { const isSoldOut = soldOut.includes(item.id); const sold = [16, 7, 9, 5, 8, 14][index]; return <div className="inventory-line" key={item.id}><span className="inventory-product"><img src={item.image} alt={item.name} /><b>{item.name}</b></span><span>{sold + item.stock}</span><span>{sold}</span><span className={item.stock <= 3 ? "low-stock" : ""}>{isSoldOut ? 0 : item.stock}</span><span><i className={isSoldOut ? "off" : "on"} />{isSoldOut ? "已售罄" : "销售中"}</span><span><button onClick={() => toggleSoldOut(item.id)}>{isSoldOut ? "恢复销售" : "临时售罄"}</button></span></div>; })}</div><p className="inventory-note">临时售罄会立即同步至顾客端；已支付订单保持原订单快照，不受影响。</p></div>;
}

type CheckoutProps = { step: "bag" | "confirm" | "success"; close: () => void; lines: Array<Product & { qty: number }>; add: (id: number) => void; remove: (id: number) => void; count: number; subtotal: number; packageFee: number; total: number; slot: number; setSlot: (slot: number) => void; next: () => void; pay: () => void; viewOrder: () => void; goMerchant: () => void };

function CheckoutSheet(props: CheckoutProps) {
  return <div className="checkout-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.close()}><section className="checkout-sheet" role="dialog" aria-modal="true"><div className="sheet-handle" />{props.step === "success" ? <div className="payment-success"><div>✓</div><small>PAYMENT SUCCESS</small><h2>支付成功</h2><p>门店已收到订单，请等待接单</p><span><small>取餐码</small><b>A0 82</b></span><button onClick={props.viewOrder}>查看订单进度</button><button className="merchant-jump" onClick={props.goMerchant}>切换到门店工作台，继续演示 →</button></div> : props.step === "bag" ? <><header className="sheet-title"><div><small>YOUR BAG</small><h2>购物袋</h2></div><button onClick={props.close}>×</button></header><div className="bag-lines">{props.lines.map((line) => <div className="bag-line" key={line.id}><img src={line.image} alt={line.name} /><div><b>{line.name}</b><small>{line.subtitle}</small><strong>¥{line.price}</strong></div><div className="qty-step"><button onClick={() => props.remove(line.id)}>−</button><span>{line.qty}</span><button onClick={() => props.add(line.id)}>＋</button></div></div>)}</div><div className="pickup-lock"><span>⌖</span><div><small>唯一履约方式</small><b>预约到店自提</b></div><i>✓</i></div><Bill subtotal={props.subtotal} packageFee={props.packageFee} total={props.total} /><button className="sheet-primary" disabled={!props.count} onClick={props.next}>确认商品，去结算</button></> : <><header className="sheet-title"><button className="back" onClick={() => {}}>‹</button><div><small>CHECKOUT</small><h2>确认订单</h2></div><button onClick={props.close}>×</button></header><div className="confirm-card"><span>⌖</span><div><small>自提门店</small><b>小雨面包 · 首店</b><p>门店地址将在正式上线前补充</p></div><i>›</i></div><div className="confirm-card slot-card"><span>◷</span><div><small>预约取货时间</small><b>今天 {SLOTS[props.slot].time}</b><p>当前余 {SLOTS[props.slot].left} 单可约</p></div><button onClick={() => props.setSlot((props.slot + 1) % SLOTS.length)}>更换</button></div><div className="confirm-card"><span>♙</span><div><small>取货人</small><b>张女士　138 **** 0826</b><p>仅用于取货通知与订单联系</p></div><i>›</i></div><div className="mini-goods">{props.lines.slice(0, 3).map((line) => <img key={line.id} src={line.image} alt={line.name} />)}<span>共 {props.count} 件</span><b>¥{money(props.subtotal)}</b></div><Bill subtotal={props.subtotal} packageFee={props.packageFee} total={props.total} /><button className="sheet-primary pay" onClick={props.pay}><span>模拟微信支付</span><b>¥{money(props.total)}</b></button><p className="agreement">提交即表示同意《用户协议》《退款规则》</p></>}</section></div>;
}

function Bill({ subtotal, packageFee, total }: { subtotal: number; packageFee: number; total: number }) {
  return <div className="bill"><p><span>商品小计</span><b>¥{money(subtotal)}</b></p><p><span>包装费</span><b>¥{packageFee}</b></p><strong><span>合计</span><b>¥{money(total)}</b></strong></div>;
}
