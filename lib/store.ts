import { env } from "cloudflare:workers";
import {
  ACTIVE_ORDER_FLOW,
  NEXT_ORDER_STATUS,
  ORDER_STATUS_LABELS,
  type BootstrapDto,
  type OrderDto,
  type OrderItemDto,
  type OrderStatus,
  type ProductDto,
  type SlotDto,
} from "./domain";
import { HttpError } from "./http";
import { PRODUCT_SEED, SLOT_SEED } from "./seed";

type Actor = { userId: string; email: string };
type D1Row = Record<string, unknown>;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    planned_stock INTEGER NOT NULL,
    sold_stock INTEGER NOT NULL DEFAULT 0,
    reserved_stock INTEGER NOT NULL DEFAULT 0,
    is_sold_out INTEGER NOT NULL DEFAULT 0,
    tag TEXT,
    image_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS pickup_slots (
    id INTEGER PRIMARY KEY,
    business_date TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    reserved_count INTEGER NOT NULL DEFAULT 0,
    paid_count INTEGER NOT NULL DEFAULT 0,
    is_closed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    display_number TEXT NOT NULL,
    pickup_code_hash TEXT NOT NULL,
    pickup_code_display TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone_masked TEXT NOT NULL,
    customer_user_id TEXT NOT NULL,
    slot_id INTEGER NOT NULL REFERENCES pickup_slots(id),
    status TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    package_fee_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    adapter_mode TEXT NOT NULL DEFAULT 'demo',
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_subtitle TEXT NOT NULL,
    image_url TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS integration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT REFERENCES orders(id),
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_products_category_sort ON products(category, sort_order)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_slots_date_start ON pickup_slots(business_date, starts_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key)",
  "CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_status_slot ON orders(status, slot_id)",
  "CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_entity_created ON audit_logs(entity_type, entity_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_integration_order_created ON integration_events(order_id, created_at)",
  `CREATE TRIGGER IF NOT EXISTS trg_products_stock_guard
    BEFORE UPDATE OF sold_stock, reserved_stock ON products
    WHEN NEW.sold_stock < 0 OR NEW.reserved_stock < 0 OR NEW.sold_stock + NEW.reserved_stock > NEW.planned_stock
    BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_PRODUCT_STOCK'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_slots_capacity_guard
    BEFORE UPDATE OF paid_count, reserved_count ON pickup_slots
    WHEN NEW.paid_count < 0 OR NEW.reserved_count < 0 OR NEW.paid_count + NEW.reserved_count > NEW.capacity
    BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_SLOT_CAPACITY'); END`,
];

let initialized: Promise<void> | null = null;

function d1() {
  if (!env.DB) throw new Error("Cloudflare D1 binding DB is unavailable");
  return env.DB;
}

export function ensureDatabase() {
  if (!initialized) initialized = initializeDatabase().catch((error) => {
    initialized = null;
    throw error;
  });
  return initialized;
}

async function initializeDatabase() {
  const db = d1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const count = await db.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>();
  if (!count?.count) {
    await db.batch(PRODUCT_SEED.map((product, index) => db.prepare(
      `INSERT INTO products (id, name, subtitle, category, price_cents, planned_stock, sold_stock, reserved_stock, is_sold_out, tag, image_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).bind(product.id, product.name, product.subtitle, product.category, product.priceCents, product.plannedStock, [16, 7, 9, 5, 8, 14][index], product.tag, product.imageUrl, product.sortOrder)));
  }
  const slotCount = await db.prepare("SELECT COUNT(*) AS count FROM pickup_slots").first<{ count: number }>();
  if (!slotCount?.count) {
    await db.batch(SLOT_SEED.map((slot) => db.prepare(
      `INSERT INTO pickup_slots (id, business_date, starts_at, ends_at, capacity, reserved_count, paid_count, is_closed)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0)`,
    ).bind(slot.id, slot.businessDate, slot.startsAt, slot.endsAt, slot.capacity, slot.paidCount)));
  }
  await db.prepare("PRAGMA optimize").run();
}

function shanghaiBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function ensureTodaySlots() {
  const db = d1();
  const businessDate = shanghaiBusinessDate();
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM pickup_slots WHERE business_date = ?").bind(businessDate).first<{ count: number }>();
  if (!existing?.count) {
    await db.batch([
      ["15:40", "15:50"], ["16:00", "16:10"], ["16:20", "16:30"],
    ].map(([startsAt, endsAt]) => db.prepare(
      "INSERT INTO pickup_slots (business_date, starts_at, ends_at, capacity, reserved_count, paid_count, is_closed) VALUES (?, ?, ?, 12, 0, 0, 0)",
    ).bind(businessDate, startsAt, endsAt)));
  }
  return businessDate;
}

async function cleanupExpiredReservations() {
  const expired = await d1().prepare("SELECT * FROM orders WHERE status = 'pending_payment' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP").all<D1Row>();
  for (const order of expired.results) {
    await releaseReservation(order, { userId: "system", email: "system@xiaoyu.local" }, "order.expired");
  }
}

function productDto(row: D1Row): ProductDto {
  const plannedStock = Number(row.planned_stock);
  const soldStock = Number(row.sold_stock);
  const reservedStock = Number(row.reserved_stock);
  const isSoldOut = Boolean(row.is_sold_out);
  return {
    id: Number(row.id), name: String(row.name), subtitle: String(row.subtitle), category: String(row.category),
    priceCents: Number(row.price_cents), plannedStock, soldStock, reservedStock,
    availableStock: isSoldOut ? 0 : Math.max(0, plannedStock - soldStock - reservedStock),
    isSoldOut, tag: row.tag == null ? null : String(row.tag), imageUrl: String(row.image_url),
  };
}

function slotDto(row: D1Row): SlotDto {
  const capacity = Number(row.capacity);
  const reservedCount = Number(row.reserved_count);
  const paidCount = Number(row.paid_count);
  const isClosed = Boolean(row.is_closed);
  return {
    id: Number(row.id), businessDate: String(row.business_date), startsAt: String(row.starts_at), endsAt: String(row.ends_at),
    capacity, reservedCount, paidCount, availableCapacity: isClosed ? 0 : Math.max(0, capacity - paidCount - reservedCount), isClosed,
  };
}

async function orderDto(orderRow: D1Row): Promise<OrderDto> {
  const db = d1();
  const itemRows = await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(String(orderRow.id)).all<D1Row>();
  const slotRow = await db.prepare("SELECT * FROM pickup_slots WHERE id = ?").bind(Number(orderRow.slot_id)).first<D1Row>();
  if (!slotRow) throw new Error("Order pickup slot is missing");
  const status = String(orderRow.status) as OrderStatus;
  const items: OrderItemDto[] = itemRows.results.map((row) => ({
    productId: Number(row.product_id), productName: String(row.product_name), productSubtitle: String(row.product_subtitle),
    imageUrl: String(row.image_url), unitPriceCents: Number(row.unit_price_cents), quantity: Number(row.quantity), lineTotalCents: Number(row.line_total_cents),
  }));
  return {
    id: String(orderRow.id), displayNumber: String(orderRow.display_number), pickupCodeDisplay: String(orderRow.pickup_code_display),
    customerName: String(orderRow.customer_name), customerPhoneMasked: String(orderRow.customer_phone_masked), customerUserId: String(orderRow.customer_user_id),
    slotId: Number(orderRow.slot_id), status, statusLabel: ORDER_STATUS_LABELS[status], paymentStatus: String(orderRow.payment_status) as OrderDto["paymentStatus"],
    subtotalCents: Number(orderRow.subtotal_cents), packageFeeCents: Number(orderRow.package_fee_cents), totalCents: Number(orderRow.total_cents),
    remark: String(orderRow.remark), adapterMode: String(orderRow.adapter_mode), createdAt: String(orderRow.created_at), updatedAt: String(orderRow.updated_at),
    expiresAt: orderRow.expires_at == null ? null : String(orderRow.expires_at),
    completedAt: orderRow.completed_at == null ? null : String(orderRow.completed_at), items, slot: slotDto(slotRow),
  };
}

export async function getBootstrap(customerUserId?: string): Promise<BootstrapDto> {
  await ensureDatabase();
  await cleanupExpiredReservations();
  const businessDate = await ensureTodaySlots();
  const db = d1();
  const [productRows, slotRows] = await Promise.all([
    db.prepare("SELECT * FROM products ORDER BY sort_order, id").all<D1Row>(),
    db.prepare("SELECT * FROM pickup_slots WHERE business_date = ? ORDER BY starts_at").bind(businessDate).all<D1Row>(),
  ]);
  const latest = customerUserId
    ? await db.prepare("SELECT * FROM orders WHERE customer_user_id = ? ORDER BY created_at DESC LIMIT 1").bind(customerUserId).first<D1Row>()
    : await db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 1").first<D1Row>();
  return { products: productRows.results.map(productDto), slots: slotRows.results.map(slotDto), latestOrder: latest ? await orderDto(latest) : null, adapterMode: "demo" };
}

export async function reserveOrder(input: {
  customerUserId: string; customerName: string; customerPhoneMasked: string; slotId: number; items: Array<{ productId: number; quantity: number }>; remark: string; idempotencyKey: string;
}, actor: Actor): Promise<OrderDto> {
  await ensureDatabase();
  await cleanupExpiredReservations();
  await ensureTodaySlots();
  const db = d1();
  if (!input.items.length) throw new HttpError(400, "购物袋不能为空");
  if (!input.idempotencyKey.trim()) throw new HttpError(400, "缺少幂等键");
  const existing = await db.prepare("SELECT * FROM orders WHERE idempotency_key = ?").bind(input.idempotencyKey).first<D1Row>();
  if (existing) return orderDto(existing);
  const slot = await db.prepare("SELECT * FROM pickup_slots WHERE id = ?").bind(input.slotId).first<D1Row>();
  if (!slot || Boolean(slot.is_closed)) throw new HttpError(409, "该取货时段已关闭");
  if (Number(slot.capacity) - Number(slot.paid_count) - Number(slot.reserved_count) < 1) throw new HttpError(409, "该取货时段已满");

  const normalized = new Map<number, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new HttpError(400, "商品数量无效");
    normalized.set(item.productId, (normalized.get(item.productId) || 0) + item.quantity);
  }
  const selectedRows: D1Row[] = [];
  for (const [productId, quantity] of normalized) {
    const product = await db.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<D1Row>();
    if (!product || Boolean(product.is_sold_out)) throw new HttpError(409, "商品已售罄或不存在");
    if (Number(product.planned_stock) - Number(product.sold_stock) - Number(product.reserved_stock) < quantity) throw new HttpError(409, `${product.name} 库存不足`);
    selectedRows.push({ ...product, quantity });
  }
  const subtotalCents = selectedRows.reduce((sum, row) => sum + Number(row.price_cents) * Number(row.quantity), 0);
  const packageFeeCents = 200;
  const totalCents = subtotalCents + packageFeeCents;
  const id = crypto.randomUUID();
  const displayNumber = `XY${Math.floor(1000 + Math.random() * 9000)}`;
  const pickupCode = `A${Math.floor(100 + Math.random() * 900)}`;
  const pickupCodeHash = await sha256(pickupCode);
  const pickupCodeDisplay = `${pickupCode.slice(0, 2)} ${pickupCode.slice(2)}`;
  const statements = [
    ...selectedRows.map((row) => db.prepare("UPDATE products SET reserved_stock = reserved_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(Number(row.quantity), Number(row.id))),
    db.prepare("UPDATE pickup_slots SET reserved_count = reserved_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(input.slotId),
    db.prepare(`INSERT INTO orders (id, display_number, pickup_code_hash, pickup_code_display, customer_name, customer_phone_masked, customer_user_id, slot_id, status, payment_status, subtotal_cents, package_fee_cents, total_cents, remark, adapter_mode, idempotency_key, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'pending', ?, ?, ?, ?, 'demo', ?, datetime('now', '+10 minutes'))`)
      .bind(id, displayNumber, pickupCodeHash, pickupCodeDisplay, input.customerName, input.customerPhoneMasked, input.customerUserId, input.slotId, subtotalCents, packageFeeCents, totalCents, input.remark, input.idempotencyKey),
    ...selectedRows.map((row) => db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_subtitle, image_url, unit_price_cents, quantity, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, Number(row.id), String(row.name), String(row.subtitle), String(row.image_url), Number(row.price_cents), Number(row.quantity), Number(row.price_cents) * Number(row.quantity))),
    db.prepare("INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, after_json) VALUES (?, ?, 'order.reserved', 'order', ?, ?)")
      .bind(actor.userId, actor.email, id, JSON.stringify({ status: "pending_payment", totalCents, adapterMode: "demo" })),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("INSUFFICIENT_PRODUCT_STOCK")) throw new HttpError(409, "库存刚刚发生变化，请刷新后重试");
    if (message.includes("INSUFFICIENT_SLOT_CAPACITY")) throw new HttpError(409, "取货时段刚刚约满，请选择其他时段");
    throw error;
  }
  const created = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<D1Row>();
  if (!created) throw new Error("Order was not created");
  return orderDto(created);
}

export async function confirmOrderPaid(orderId: string, actor: Actor): Promise<OrderDto> {
  await ensureDatabase();
  const db = d1();
  const current = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<D1Row>();
  if (!current) throw new HttpError(404, "订单不存在");
  if (String(current.customer_user_id) !== actor.userId) throw new HttpError(403, "无权支付此订单");
  if (String(current.payment_status) === "paid") return orderDto(current);
  if (String(current.status) !== "pending_payment") throw new HttpError(409, "订单当前不可支付");
  if (current.expires_at && new Date(String(current.expires_at)).getTime() <= Date.now()) {
    await releaseReservation(current, actor, "order.expired");
    throw new HttpError(409, "订单已超时，请重新下单");
  }
  const items = await db.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(orderId).all<D1Row>();
  await db.batch([
    ...items.results.map((item) => db.prepare("UPDATE products SET reserved_stock = reserved_stock - ?, sold_stock = sold_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(Number(item.quantity), Number(item.quantity), Number(item.product_id))),
    db.prepare("UPDATE pickup_slots SET reserved_count = reserved_count - 1, paid_count = paid_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(Number(current.slot_id)),
    db.prepare("UPDATE orders SET status = 'pending_acceptance', payment_status = 'paid', expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(orderId),
    db.prepare("INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, 'order.paid', 'order', ?, ?, ?)")
      .bind(actor.userId, actor.email, orderId, JSON.stringify({ status: "pending_payment" }), JSON.stringify({ status: "pending_acceptance", paymentStatus: "paid" })),
  ]);
  const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<D1Row>();
  if (!updated) throw new Error("Paid order is missing");
  return orderDto(updated);
}

async function releaseReservation(order: D1Row, actor: Actor, action: string) {
  const db = d1();
  const items = await db.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(String(order.id)).all<D1Row>();
  await db.batch([
    ...items.results.map((item) => db.prepare("UPDATE products SET reserved_stock = reserved_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(Number(item.quantity), Number(item.product_id))),
    db.prepare("UPDATE pickup_slots SET reserved_count = reserved_count - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(Number(order.slot_id)),
    db.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'failed', expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(String(order.id)),
    db.prepare("INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, 'order', ?, ?, ?)")
      .bind(actor.userId, actor.email, action, String(order.id), JSON.stringify({ status: "pending_payment" }), JSON.stringify({ status: "cancelled" })),
  ]);
}

export async function recordIntegrationEvent(orderId: string | null, operation: string, result: { provider: string; reference: string; message: string }, status: "succeeded" | "failed" = "succeeded") {
  await ensureDatabase();
  await d1().prepare("INSERT INTO integration_events (order_id, provider, operation, reference, status, message) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(orderId, result.provider, operation, result.reference, status, result.message).run();
}

export async function transitionOrder(orderId: string, nextStatus: OrderStatus, actor: Actor, pickupCode?: string): Promise<OrderDto> {
  await ensureDatabase();
  const db = d1();
  const current = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<D1Row>();
  if (!current) throw new HttpError(404, "订单不存在");
  const currentStatus = String(current.status) as OrderStatus;
  if (nextStatus === "completed") {
    if (currentStatus !== "ready") throw new HttpError(409, "只有待取货订单可以核销");
    if (!pickupCode || (await sha256(pickupCode.replace(/\s/g, "").toUpperCase())) !== String(current.pickup_code_hash)) throw new HttpError(400, "取餐码不正确");
  } else if (NEXT_ORDER_STATUS[currentStatus] !== nextStatus) {
    throw new HttpError(409, `订单不能从“${ORDER_STATUS_LABELS[currentStatus]}”变更为“${ORDER_STATUS_LABELS[nextStatus]}”`);
  }
  const completedSql = nextStatus === "completed" ? ", completed_at = CURRENT_TIMESTAMP" : "";
  await db.batch([
    db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP${completedSql} WHERE id = ?`).bind(nextStatus, orderId),
    db.prepare("INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, 'order.status_changed', 'order', ?, ?, ?)")
      .bind(actor.userId, actor.email, orderId, JSON.stringify({ status: currentStatus }), JSON.stringify({ status: nextStatus })),
  ]);
  const updated = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<D1Row>();
  if (!updated) throw new Error("Updated order is missing");
  return orderDto(updated);
}

export async function setProductSoldOut(productId: number, isSoldOut: boolean, actor: Actor): Promise<ProductDto> {
  await ensureDatabase();
  const db = d1();
  const before = await db.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<D1Row>();
  if (!before) throw new HttpError(404, "商品不存在");
  await db.batch([
    db.prepare("UPDATE products SET is_sold_out = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(isSoldOut ? 1 : 0, productId),
    db.prepare("INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, 'product.availability_changed', 'product', ?, ?, ?)")
      .bind(actor.userId, actor.email, String(productId), JSON.stringify({ isSoldOut: Boolean(before.is_sold_out) }), JSON.stringify({ isSoldOut })),
  ]);
  const updated = await db.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<D1Row>();
  if (!updated) throw new Error("Updated product is missing");
  return productDto(updated);
}

export async function getOrder(orderId: string, customerUserId?: string) {
  await ensureDatabase();
  const row = await d1().prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<D1Row>();
  if (!row) throw new HttpError(404, "订单不存在");
  if (customerUserId && String(row.customer_user_id) !== customerUserId) throw new HttpError(403, "无权查看此订单");
  return orderDto(row);
}

export function nextOrderStatus(status: OrderStatus) {
  return NEXT_ORDER_STATUS[status] || null;
}

export function isActiveStatus(status: OrderStatus) {
  return ACTIVE_ORDER_FLOW.includes(status);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
