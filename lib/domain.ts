export const CUSTOMER_ID = "demo-customer";
export const CUSTOMER_EMAIL = "customer@xiaoyu.demo";
export const MERCHANT_ID = "demo-merchant";
export const MERCHANT_EMAIL = "store@xiaoyu.demo";

export type OrderStatus =
  | "pending_payment"
  | "pending_acceptance"
  | "accepted"
  | "making"
  | "ready"
  | "completed"
  | "cancelled"
  | "refunding"
  | "refunded";

export type PaymentStatus = "pending" | "paid" | "refunding" | "refunded" | "failed";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待支付",
  pending_acceptance: "待接单",
  accepted: "已接单",
  making: "制作中",
  ready: "待取货",
  completed: "已完成",
  cancelled: "已取消",
  refunding: "退款中",
  refunded: "已退款",
};

export const ACTIVE_ORDER_FLOW: OrderStatus[] = [
  "pending_acceptance",
  "accepted",
  "making",
  "ready",
  "completed",
];

export const NEXT_ORDER_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending_acceptance: "accepted",
  accepted: "making",
  making: "ready",
};

export type ProductDto = {
  id: number;
  name: string;
  subtitle: string;
  category: string;
  priceCents: number;
  plannedStock: number;
  soldStock: number;
  reservedStock: number;
  availableStock: number;
  isSoldOut: boolean;
  tag: string | null;
  imageUrl: string;
};

export type SlotDto = {
  id: number;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reservedCount: number;
  paidCount: number;
  availableCapacity: number;
  isClosed: boolean;
};

export type OrderItemDto = {
  productId: number;
  productName: string;
  productSubtitle: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type OrderDto = {
  id: string;
  displayNumber: string;
  pickupCodeDisplay: string;
  customerName: string;
  customerPhoneMasked: string;
  customerUserId: string;
  slotId: number;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: PaymentStatus;
  subtotalCents: number;
  packageFeeCents: number;
  totalCents: number;
  remark: string;
  adapterMode: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
  items: OrderItemDto[];
  slot: SlotDto;
};

export type BootstrapDto = {
  products: ProductDto[];
  slots: SlotDto[];
  latestOrder: OrderDto | null;
  adapterMode: string;
};
