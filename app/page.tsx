"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapDto, OrderDto, OrderStatus, ProductDto, SlotDto } from "@/lib/domain";

type Surface = "customer" | "merchant";
type CustomerPage = "menu" | "orders" | "profile";
type MerchantPage = "orders" | "production" | "inventory";
type CheckoutStep = "bag" | "confirm" | "success" | null;

const CATEGORIES = ["全部", "今日现烤", "欧包吐司", "咸味轻食", "甜点"];
const FLOW: OrderStatus[] = ["pending_acceptance", "accepted", "making", "ready", "completed"];
const FLOW_LABELS = ["待接单", "已接单", "制作中", "待取货", "已完成"];
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  pending_acceptance: "accepted",
  accepted: "making",
  making: "ready",
};

function money(cents: number) {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

function slotText(slot?: SlotDto) {
  return slot ? `${slot.startsAt}–${slot.endsAt}` : "暂无可约时段";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
  return data;
}

export default function Home() {
  const [surface, setSurface] = useState<Surface>("customer");
  const [customerPage, setCustomerPage] = useState<CustomerPage>("menu");
  const [merchantPage, setMerchantPage] = useState<MerchantPage>("orders");
  const [category, setCategory] = useState("全部");
  const [slotIndex, setSlotIndex] = useState(0);
  const [cart, setCart] = useState<Record<number, number>>({ 1: 1 });
  const [checkout, setCheckout] = useState<CheckoutStep>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [toast, setToast] = useState("");
  const [data, setData] = useState<BootstrapDto>({ products: [], slots: [], latestOrder: null, adapterMode: "demo" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const notify = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await api<BootstrapDto>(`/api/bootstrap?surface=${surface}`));
    } catch (error) {
      if (!quiet) notify(error instanceof Error ? error.message : "数据加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify, surface]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const selectedSlot = data.slots[slotIndex] || data.slots[0];
  const visibleProducts = category === "全部" ? data.products : data.products.filter((product) => product.category === category);
  const cartLines = data.products.filter((product) => cart[product.id]).map((product) => ({ product, quantity: cart[product.id] }));
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalCents = cartLines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
  const packageFeeCents = itemCount ? 200 : 0;
  const totalCents = subtotalCents + packageFeeCents;

  const add = (product: ProductDto) => {
    const quantity = cart[product.id] || 0;
    if (product.isSoldOut || !product.availableStock) return notify("该商品已临时售罄");
    if (quantity >= product.availableStock) return notify("已达到今日可售余量");
    setCart((current) => ({ ...current, [product.id]: quantity + 1 }));
    notify("已加入购物袋");
  };

  const remove = (productId: number) => setCart((current) => {
    const next = { ...current };
    if ((next[productId] || 0) <= 1) delete next[productId];
    else next[productId] -= 1;
    return next;
  });

  const pay = async () => {
    if (!selectedSlot || !cartLines.length) return notify("请选择商品和取货时段");
    setBusy(true);
    try {
      const result = await api<{ order: OrderDto }>("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slotId: selectedSlot.id,
          items: cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
          customerName: "张女士",
          customerPhoneMasked: "138 **** 0826",
          remark: "可颂请装纸袋",
          idempotencyKey: idempotencyKey.current,
        }),
      });
      setData((current) => ({ ...current, latestOrder: result.order }));
      setCheckout("success");
      idempotencyKey.current = crypto.randomUUID();
      await refresh(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "支付失败");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (nextStatus: OrderStatus, pickupCode?: string) => {
    if (!data.latestOrder) return;
    setBusy(true);
    try {
      const result = await api<{ order: OrderDto }>(`/api/orders/${data.latestOrder.id}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nextStatus, pickupCode }),
      });
      setData((current) => ({ ...current, latestOrder: result.order }));
      setVerifyCode("");
      notify(nextStatus === "completed" ? "核销成功，订单已完成" : `订单已更新为“${result.order.statusLabel}”`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "状态更新失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleSoldOut = async (product: ProductDto) => {
    setBusy(true);
    try {
      await api(`/api/products/${product.id}/availability`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isSoldOut: !product.isSoldOut }),
      });
      await refresh(true);
      notify(product.isSoldOut ? "已恢复销售" : "已同步售罄状态");
    } catch (error) {
      notify(error instanceof Error ? error.message : "库存状态更新失败");
    } finally {
      setBusy(false);
    }
  };

  return <main className="xy-site">
    <header className="xy-header">
      <button className="xy-brand" onClick={() => setSurface("customer")} aria-label="小雨面包顾客端"><span className="rain-mark"><i /><i /><i /></span><span><b>小雨面包</b><small>XIAOYU BAKEHOUSE</small></span></button>
      <nav className="surface-switch" aria-label="演示端切换">
        <button className={surface === "customer" ? "active" : ""} onClick={() => setSurface("customer")}><span>◉</span> 顾客小程序</button>
        <button className={surface === "merchant" ? "active" : ""} onClick={() => setSurface("merchant")}><span>▦</span> 门店工作台 {data.latestOrder?.status === "pending_acceptance" && <i>1</i>}</button>
      </nav>
      <div className="header-meta"><span className="online-dot" /> D1 模拟业务 Demo</div>
    </header>

    {surface === "customer" ? <CustomerSurface
      page={customerPage} setPage={setCustomerPage} category={category} setCategory={setCategory}
      products={visibleProducts} allProducts={data.products} slots={data.slots} slotIndex={slotIndex} setSlotIndex={setSlotIndex}
      cart={cart} add={add} remove={remove} itemCount={itemCount} subtotalCents={subtotalCents}
      openBag={() => setCheckout("bag")} order={data.latestOrder} loading={loading}
    /> : <MerchantSurface
      page={merchantPage} setPage={setMerchantPage} order={data.latestOrder} products={data.products} slots={data.slots}
      verifyCode={verifyCode} setVerifyCode={setVerifyCode} transition={transition} toggleSoldOut={toggleSoldOut} busy={busy}
    />}

    {checkout && <CheckoutSheet step={checkout} close={() => setCheckout(null)} lines={cartLines} add={add} remove={remove}
      itemCount={itemCount} subtotalCents={subtotalCents} packageFeeCents={packageFeeCents} totalCents={totalCents}
      slots={data.slots} slotIndex={slotIndex} setSlotIndex={setSlotIndex} next={() => setCheckout("confirm")} pay={pay} busy={busy}
      order={data.latestOrder} viewOrder={() => { setCheckout(null); setCustomerPage("orders"); }} goMerchant={() => { setCheckout(null); setSurface("merchant"); }} />}
    {toast && <div className="xy-toast">{toast}</div>}
  </main>;
}

type CustomerProps = {
  page: CustomerPage; setPage: (page: CustomerPage) => void; category: string; setCategory: (category: string) => void;
  products: ProductDto[]; allProducts: ProductDto[]; slots: SlotDto[]; slotIndex: number; setSlotIndex: (index: number) => void;
  cart: Record<number, number>; add: (product: ProductDto) => void; remove: (id: number) => void; itemCount: number;
  subtotalCents: number; openBag: () => void; order: OrderDto | null; loading: boolean;
};

function CustomerSurface(props: CustomerProps) {
  return <section className="customer-stage">
    <aside className="customer-intro"><p className="overline">CUSTOMER EXPERIENCE · MVP</p><h1>今天出炉，<br />今天带走。</h1><p>小雨面包首发只做预约到店自提。顾客先确认余量与取货时间，再完成支付，门店按时段集中生产。</p><div className="promise-list"><span><i>01</i><b>余量真实</b><small>下单预占，支付后转为已售</small></span><span><i>02</i><b>时间明确</b><small>每 10 分钟一个自提时段</small></span><span><i>03</i><b>取货简单</b><small>动态取餐码，店员一次核销</small></span></div><div className="scope-note"><b>本期范围</b><span>预约自提</span><span>支付适配</span><span>门店核销</span></div></aside>
    <div className="phone-wrap"><div className="xy-phone"><div className="phone-status"><span>9:41</span><i /><span>5G · ▰</span></div><div className="customer-app">
      {props.page === "menu" && <CustomerMenu {...props} />}
      {props.page === "orders" && <CustomerOrders order={props.order} setPage={props.setPage} />}
      {props.page === "profile" && <CustomerProfile />}
      {props.itemCount > 0 && props.page === "menu" && <button className="floating-cart" onClick={props.openBag}><span className="cart-symbol">▱<i>{props.itemCount}</i></span><span><small>已选 {props.itemCount} 件</small><b>¥{money(props.subtotalCents)}</b></span><strong>去结算</strong></button>}
      <nav className="customer-nav"><button className={props.page === "menu" ? "active" : ""} onClick={() => props.setPage("menu")}><span>▦</span><small>点单</small></button><button className={props.page === "orders" ? "active" : ""} onClick={() => props.setPage("orders")}><span>▤</span><small>订单</small>{props.order && props.order.status !== "completed" && <i />}</button><button className={props.page === "profile" ? "active" : ""} onClick={() => props.setPage("profile")}><span>◉</span><small>我的</small></button></nav>
    </div><div className="home-bar" /></div></div>
    <aside className="customer-guide"><p>端到端体验路径</p><ol><li><span>1</span>选择取货时段</li><li><span>2</span>添加两件商品</li><li><span>3</span>模拟微信支付</li><li><span>4</span>门店接单至核销</li></ol><div className="no-delivery"><span>✓</span><div><b>仅预约自提</b><small>无配送入口、地址或配送费用</small></div></div></aside>
  </section>;
}

function CustomerMenu(props: CustomerProps) {
  const selectedSlot = props.slots[props.slotIndex] || props.slots[0];
  return <div className="menu-page"><header className="mini-header"><div><p>小雨面包 <span>⌄</span></p><small><i /> 营业中 · 21:30 打烊</small></div><button>•••</button></header><div className="pickup-only"><span>到店自提</span><b>小雨面包 · 首店</b><small>门店地址待确认 ›</small></div>
    <button className="slot-summary" disabled={!props.slots.length} onClick={() => props.setSlotIndex((props.slotIndex + 1) % props.slots.length)}><span>预约取货</span><b>今天 {slotText(selectedSlot)}</b><em>{selectedSlot ? `余 ${selectedSlot.availableCapacity} 单可约` : "准备中"} · ⌄</em></button>
    <div className="fresh-notice"><b>新鲜提示</b> 下午第二炉可颂 15:30 出炉</div><div className="menu-columns"><nav className="category-nav">{CATEGORIES.map((item) => <button key={item} className={props.category === item ? "active" : ""} onClick={() => props.setCategory(item)}>{item}</button>)}</nav><div className="product-list"><div className="list-title"><div><b>{props.category === "全部" ? "今日推荐" : props.category}</b><small>当日制作 · 售完即止</small></div><span>{props.products.length} 款</span></div>
      {props.loading && <div className="merchant-empty"><span>◷</span><p>正在同步今日菜单…</p></div>}
      {props.products.map((product) => { const unavailable = product.isSoldOut || !product.availableStock; const qty = props.cart[product.id] || 0; return <article className={`product-row ${unavailable ? "sold-out" : ""}`} key={product.id}><div className="product-image"><img src={product.imageUrl} alt={product.name} />{product.tag && !unavailable && <span>{product.tag}</span>}{unavailable && <em>已售罄</em>}</div><div className="product-copy"><h3>{product.name}</h3><p>{product.subtitle}</p><small className={product.availableStock <= 3 ? "low" : ""}>{unavailable ? "暂不可购买" : product.availableStock <= 3 ? `仅剩 ${product.availableStock} 份` : `今日余量 ${product.availableStock}`}</small><div><b><i>¥</i>{money(product.priceCents)}</b>{qty ? <div className="qty-step"><button onClick={() => props.remove(product.id)}>−</button><span>{qty}</span><button onClick={() => props.add(product)}>＋</button></div> : <button className="add-button" disabled={unavailable} onClick={() => props.add(product)}>＋</button>}</div></div></article>; })}
    </div></div></div>;
}

function CustomerOrders({ order, setPage }: { order: OrderDto | null; setPage: (page: CustomerPage) => void }) {
  if (!order) return <div className="empty-orders"><div>▤</div><h2>还没有订单</h2><p>挑几款今天出炉的面包吧</p><button onClick={() => setPage("menu")}>去点单</button></div>;
  const current = FLOW.indexOf(order.status);
  return <div className="order-page"><header><small>MY ORDER</small><h2>我的订单</h2></header><article className="customer-order-card"><div className="order-card-top"><span>预约自提 · #{order.displayNumber}</span><b>{order.statusLabel}</b></div><div className="flow-line">{FLOW_LABELS.map((label, index) => <span key={label} className={index <= current ? "done" : ""}><i />{label}</span>)}</div><div className="order-goods">{order.items.slice(0, 2).map((item) => <img key={item.productId} src={item.imageUrl} alt={item.productName} />)}<div><b>{order.items[0]?.productName}{order.items.length > 1 ? "等" : ""}</b><small>共 {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件 · ¥{money(order.totalCents)}</small></div></div><div className="pickup-code"><small>到店出示取餐码</small><b>{order.pickupCodeDisplay}</b><span>{order.status === "ready" ? "面包已备妥，可以来取啦" : order.status === "completed" ? "已于门店完成核销" : `预计今天 ${order.slot.startsAt} 可取`}</span></div><div className="order-actions"><button>联系门店</button><button>订单详情</button></div></article></div>;
}

function CustomerProfile() {
  return <div className="profile-page"><div className="profile-head"><span>雨</span><div><h2>下午好，面包朋友</h2><p>当前已用私有站点身份同步订单</p></div></div><div className="profile-stats"><span><b>2</b><small>优惠券</small></span><span><b>0</b><small>积分</small></span><span><b>1</b><small>收藏</small></span></div><div className="profile-menu"><button><span>♧</span><b>常用取货人</b><i>›</i></button><button><span>♡</span><b>过敏原偏好</b><i>›</i></button><button><span>♙</span><b>联系客服</b><i>›</i></button><button><span>ⓘ</span><b>门店与资质</b><i>›</i></button></div></div>;
}

type MerchantProps = { page: MerchantPage; setPage: (page: MerchantPage) => void; order: OrderDto | null; products: ProductDto[]; slots: SlotDto[]; verifyCode: string; setVerifyCode: (code: string) => void; transition: (status: OrderStatus, code?: string) => Promise<void>; toggleSoldOut: (product: ProductDto) => Promise<void>; busy: boolean };

function MerchantSurface(props: MerchantProps) {
  const today = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return <section className="merchant-shell"><aside className="merchant-sidebar"><div className="merchant-logo"><span className="rain-mark small"><i /><i /><i /></span><div><b>小雨面包</b><small>门店工作台</small></div></div><nav><button className={props.page === "orders" ? "active" : ""} onClick={() => props.setPage("orders")}><span>▤</span>订单中心{props.order?.status === "pending_acceptance" && <i>1</i>}</button><button className={props.page === "production" ? "active" : ""} onClick={() => props.setPage("production")}><span>♨</span>生产看板</button><button className={props.page === "inventory" ? "active" : ""} onClick={() => props.setPage("inventory")}><span>▦</span>今日库存</button></nav><div className="sidebar-bottom"><span className="online-dot" /> 小雨面包 · 首店<small>营业中 · 21:30 打烊</small></div></aside><div className="merchant-main"><header className="merchant-top"><div><p>{today}</p><h1>{props.page === "orders" ? "订单中心" : props.page === "production" ? "生产看板" : "今日库存"}</h1></div><div><button>⌕</button><button>⚙</button><span className="staff-avatar">店</span></div></header>{props.page === "orders" && <MerchantOrders {...props} />}{props.page === "production" && <ProductionBoard {...props} />}{props.page === "inventory" && <InventoryBoard products={props.products} toggleSoldOut={props.toggleSoldOut} busy={props.busy} />}</div></section>;
}

function MerchantOrders(props: MerchantProps) {
  const order = props.order;
  const next = order ? NEXT[order.status] : undefined;
  const orderCount = order ? 19 : 18;
  return <div className="merchant-content"><div className="kpi-row"><Kpi label="今日实收" value={`¥${order ? money(82400 + order.totalCents) : "824"}`} trend="较昨日 +12.4%" /><Kpi label="支付订单" value={String(orderCount)} trend="自提订单 100%" /><Kpi label="待处理" value={order?.status === "pending_acceptance" ? "1" : "0"} trend="请及时接单" alert={order?.status === "pending_acceptance"} /><Kpi label="准时备妥率" value="96.8%" trend="目标 ≥ 95%" /></div><div className="order-toolbar"><div><button className="active">全部订单</button><button>待接单 {order?.status === "pending_acceptance" && <i>1</i>}</button><button>制作中</button><button>待取货</button><button>已完成</button></div><div><button>筛选</button><button>导出</button></div></div>
    {order ? <article className="merchant-order"><div className="merchant-order-head"><div><span className="order-type">预约自提</span><b>#{order.displayNumber}</b><small>实时同步 · 取货 {slotText(order.slot)}</small></div><strong className={`status status-${Math.max(0, FLOW.indexOf(order.status))}`}>{order.statusLabel}</strong></div><div className="merchant-order-grid"><div className="customer-cell"><small>取货人</small><b>{order.customerName} · {order.customerPhoneMasked}</b><span>备注：{order.remark || "无"}</span></div><div className="goods-cell"><small>商品明细</small>{order.items.map((line) => <span key={line.productId}><b>{line.productName}</b><i>× {line.quantity}</i></span>)}</div><div className="amount-cell"><small>实付金额</small><b>¥{money(order.totalCents)}</b><span>微信支付 · {order.adapterMode}</span></div></div><div className="merchant-order-foot"><div><button>打印小票</button><button>联系顾客</button></div>{order.status === "ready" ? <div className="verify-box"><input value={props.verifyCode} onChange={(event) => props.setVerifyCode(event.target.value)} placeholder={`输入取餐码 ${order.pickupCodeDisplay.replace(/\s/g, "")}`} /><button disabled={props.busy} onClick={() => void props.transition("completed", props.verifyCode)}>核销取货</button></div> : next ? <button className="primary-order-action" disabled={props.busy} onClick={() => void props.transition(next)}>{order.status === "pending_acceptance" ? "接单并打印" : order.status === "accepted" ? "开始制作" : "标记已备妥"} →</button> : <span className="completed-check">✓ 已完成核销</span>}</div></article> : <div className="merchant-empty"><span>◎</span><h3>等待新订单</h3><p>请切换到顾客小程序完成一次下单</p></div>}
    <div className="order-flow-hint"><b>模拟业务流</b><span>顾客模拟支付 → 门店接单 → 开始制作 → 标记备妥 → 动态取餐码核销</span></div></div>;
}

function Kpi({ label, value, trend, alert }: { label: string; value: string; trend: string; alert?: boolean }) {
  return <div className={`kpi-card ${alert ? "alert" : ""}`}><span>{label}</span><b>{value}</b><small>{trend}</small></div>;
}

function ProductionBoard(props: MerchantProps) {
  const quantities = useMemo(() => props.products.slice(0, 3).map((product, index) => ({ product, quantity: [12, 10, 4][index] + (props.order?.status !== "completed" ? props.order?.items.find((item) => item.productId === product.id)?.quantity || 0 : 0) })), [props.products, props.order]);
  const nextSlot = props.slots[0];
  return <div className="merchant-content"><div className="production-summary"><div><p>NEXT PICKUP WINDOW</p><h2>{slotText(nextSlot)}</h2><span>已支付订单自动计入批次</span></div><div><b>{props.order?.status !== "completed" ? "7" : "6"}</b><small>待生产订单</small></div><div><b>{quantities.reduce((sum, item) => sum + item.quantity, 0)}</b><small>待制作件数</small></div><button>打印生产单</button></div><div className="production-layout"><section><header><div><small>按商品汇总</small><h3>{nextSlot?.startsAt || "今日"} 批次</h3></div><span>D1 实时汇总</span></header>{quantities.map((item, index) => <article className="production-item" key={item.product.id}><span className="sequence">0{index + 1}</span><img src={item.product.imageUrl} alt={item.product.name} /><div><b>{item.product.name}</b><small>{item.product.subtitle}</small></div><strong>{item.quantity}<small>份</small></strong><span className={index === 0 ? "making" : "waiting"}>{index === 0 ? "制作中" : "待制作"}</span></article>)}</section><aside><h3>时间段负载</h3>{props.slots.map((slot) => <div className="capacity-row" key={slot.id}><span>{slotText(slot)}</span><div><i style={{ width: `${Math.round(((slot.paidCount + slot.reservedCount) / slot.capacity) * 100)}%` }} /></div><b>{slot.paidCount + slot.reservedCount}/{slot.capacity}</b></div>)}</aside></div></div>;
}

function InventoryBoard({ products, toggleSoldOut, busy }: { products: ProductDto[]; toggleSoldOut: (product: ProductDto) => Promise<void>; busy: boolean }) {
  return <div className="merchant-content"><div className="inventory-head"><div><p>今日可售 · 实时库存</p><h2>库存与售罄管理</h2></div><button>＋ 批量调整库存</button></div><div className="inventory-table"><div className="inventory-table-head"><span>商品</span><span>计划量</span><span>已售</span><span>剩余</span><span>销售状态</span><span>操作</span></div>{products.map((product) => <div className="inventory-line" key={product.id}><span className="inventory-product"><img src={product.imageUrl} alt={product.name} /><b>{product.name}</b></span><span>{product.plannedStock}</span><span>{product.soldStock}</span><span className={product.availableStock <= 3 ? "low-stock" : ""}>{product.availableStock}</span><span><i className={product.isSoldOut ? "off" : "on"} />{product.isSoldOut ? "已售罄" : product.reservedStock ? `销售中 · 锁定 ${product.reservedStock}` : "销售中"}</span><span><button disabled={busy} onClick={() => void toggleSoldOut(product)}>{product.isSoldOut ? "恢复销售" : "临时售罄"}</button></span></div>)}</div><p className="inventory-note">临时售罄会立即同步至顾客端；已支付订单保持原订单快照，不受影响。</p></div>;
}

type CartLine = { product: ProductDto; quantity: number };
type CheckoutProps = { step: Exclude<CheckoutStep, null>; close: () => void; lines: CartLine[]; add: (product: ProductDto) => void; remove: (id: number) => void; itemCount: number; subtotalCents: number; packageFeeCents: number; totalCents: number; slots: SlotDto[]; slotIndex: number; setSlotIndex: (index: number) => void; next: () => void; pay: () => Promise<void>; busy: boolean; order: OrderDto | null; viewOrder: () => void; goMerchant: () => void };

function CheckoutSheet(props: CheckoutProps) {
  const slot = props.slots[props.slotIndex] || props.slots[0];
  return <div className="checkout-backdrop"><section className="checkout-sheet" role="dialog" aria-modal="true"><div className="sheet-handle" />{props.step === "success" ? <div className="payment-success"><div>✓</div><small>PAYMENT SUCCESS</small><h2>支付成功</h2><p>门店已收到订单，请等待接单</p><span><small>取餐码</small><b>{props.order?.pickupCodeDisplay || "生成中"}</b></span><button onClick={props.viewOrder}>查看订单进度</button><button className="merchant-jump" onClick={props.goMerchant}>切换到门店工作台，继续处理 →</button></div> : props.step === "bag" ? <><header className="sheet-title"><div><small>YOUR BAG</small><h2>购物袋</h2></div><button onClick={props.close}>×</button></header><div className="bag-lines">{props.lines.map((line) => <div className="bag-line" key={line.product.id}><img src={line.product.imageUrl} alt={line.product.name} /><div><b>{line.product.name}</b><small>{line.product.subtitle}</small><strong>¥{money(line.product.priceCents)}</strong></div><div className="qty-step"><button onClick={() => props.remove(line.product.id)}>−</button><span>{line.quantity}</span><button onClick={() => props.add(line.product)}>＋</button></div></div>)}</div><div className="pickup-lock"><span>⌖</span><div><small>唯一履约方式</small><b>预约到店自提</b></div><i>✓</i></div><Bill subtotalCents={props.subtotalCents} packageFeeCents={props.packageFeeCents} totalCents={props.totalCents} /><button className="sheet-primary" disabled={!props.itemCount} onClick={props.next}>确认商品，去结算</button></> : <><header className="sheet-title"><button className="back">‹</button><div><small>CHECKOUT</small><h2>确认订单</h2></div><button onClick={props.close}>×</button></header><div className="confirm-card"><span>⌖</span><div><small>自提门店</small><b>小雨面包 · 首店</b><p>门店地址将在正式上线前补充</p></div><i>›</i></div><div className="confirm-card slot-card"><span>◷</span><div><small>预约取货时间</small><b>今天 {slotText(slot)}</b><p>{slot ? `当前余 ${slot.availableCapacity} 单可约` : "暂无可约时段"}</p></div><button disabled={!props.slots.length} onClick={() => props.setSlotIndex((props.slotIndex + 1) % props.slots.length)}>更换</button></div><div className="confirm-card"><span>♙</span><div><small>取货人</small><b>张女士 · 138 **** 0826</b><p>仅用于取货通知与订单联系</p></div><i>›</i></div><div className="mini-goods">{props.lines.slice(0, 3).map((line) => <img key={line.product.id} src={line.product.imageUrl} alt={line.product.name} />)}<span>共 {props.itemCount} 件</span><b>¥{money(props.subtotalCents)}</b></div><Bill subtotalCents={props.subtotalCents} packageFeeCents={props.packageFeeCents} totalCents={props.totalCents} /><button className="sheet-primary pay" disabled={props.busy || !slot} onClick={() => void props.pay()}><span>{props.busy ? "正在锁定库存…" : "模拟微信支付"}</span><b>¥{money(props.totalCents)}</b></button><p className="agreement">提交即表示同意《用户协议》《退款规则》</p></>}</section></div>;
}

function Bill({ subtotalCents, packageFeeCents, totalCents }: { subtotalCents: number; packageFeeCents: number; totalCents: number }) {
  return <div className="bill"><p><span>商品小计</span><b>¥{money(subtotalCents)}</b></p><p><span>包装费</span><b>¥{money(packageFeeCents)}</b></p><strong><span>合计</span><b>¥{money(totalCents)}</b></strong></div>;
}
