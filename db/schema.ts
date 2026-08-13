import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull(),
  category: text("category").notNull(),
  priceCents: integer("price_cents").notNull(),
  plannedStock: integer("planned_stock").notNull(),
  soldStock: integer("sold_stock").notNull().default(0),
  reservedStock: integer("reserved_stock").notNull().default(0),
  isSoldOut: integer("is_sold_out", { mode: "boolean" }).notNull().default(false),
  tag: text("tag"),
  imageUrl: text("image_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_products_category_sort").on(table.category, table.sortOrder),
]);

export const pickupSlots = sqliteTable("pickup_slots", {
  id: integer("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  capacity: integer("capacity").notNull(),
  reservedCount: integer("reserved_count").notNull().default(0),
  paidCount: integer("paid_count").notNull().default(0),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_pickup_slots_date_start").on(table.businessDate, table.startsAt),
]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  displayNumber: text("display_number").notNull(),
  pickupCodeHash: text("pickup_code_hash").notNull(),
  pickupCodeDisplay: text("pickup_code_display").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhoneMasked: text("customer_phone_masked").notNull(),
  customerUserId: text("customer_user_id").notNull(),
  slotId: integer("slot_id").notNull().references(() => pickupSlots.id),
  status: text("status", { enum: ["pending_payment", "pending_acceptance", "accepted", "making", "ready", "completed", "cancelled", "refunding", "refunded"] }).notNull(),
  paymentStatus: text("payment_status", { enum: ["pending", "paid", "refunding", "refunded", "failed"] }).notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  packageFeeCents: integer("package_fee_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  remark: text("remark").notNull().default(""),
  adapterMode: text("adapter_mode").notNull().default("demo"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at"),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("idx_orders_idempotency_key").on(table.idempotencyKey),
  index("idx_orders_customer_created").on(table.customerUserId, table.createdAt),
  index("idx_orders_status_slot").on(table.status, table.slotId),
]);

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull().references(() => orders.id),
  productId: integer("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  productSubtitle: text("product_subtitle").notNull(),
  imageUrl: text("image_url").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotalCents: integer("line_total_cents").notNull(),
}, (table) => [index("idx_order_items_order").on(table.orderId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: text("actor_user_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_audit_entity_created").on(table.entityType, table.entityId, table.createdAt)]);

export const integrationEvents = sqliteTable("integration_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").references(() => orders.id),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  reference: text("reference").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_integration_order_created").on(table.orderId, table.createdAt)]);
