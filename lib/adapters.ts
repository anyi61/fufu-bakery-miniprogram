export type AdapterResult = { provider: string; reference: string; message: string };

export interface PaymentAdapter {
  createPayment(orderId: string, totalCents: number): Promise<AdapterResult>;
}

export interface NotificationAdapter {
  sendOrderStatus(orderId: string, status: string): Promise<AdapterResult>;
}

export interface PrintAdapter {
  printOrder(orderId: string): Promise<AdapterResult>;
}

export interface PospalAdapter {
  syncOrder(orderId: string): Promise<AdapterResult>;
  syncProductAvailability(productId: number, isSoldOut: boolean): Promise<AdapterResult>;
}

function reference(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export const demoPaymentAdapter: PaymentAdapter = {
  async createPayment(orderId, totalCents) {
    return { provider: "demo-wechat-pay", reference: reference("pay"), message: `Demo payment confirmed for ${orderId}: ${totalCents}` };
  },
};
export const demoNotificationAdapter: NotificationAdapter = {
  async sendOrderStatus(orderId, status) {
    return { provider: "demo-subscribe-message", reference: reference("msg"), message: `Demo notification queued for ${orderId}: ${status}` };
  },
};

export const demoPrintAdapter: PrintAdapter = {
  async printOrder(orderId) {
    return { provider: "demo-cloud-printer", reference: reference("print"), message: `Demo ticket printed for ${orderId}` };
  },
};

export const demoPospalAdapter: PospalAdapter = {
  async syncOrder(orderId) {
    return { provider: "demo-pospal", reference: reference("pospal"), message: `Demo order synced to Pospal: ${orderId}` };
  },
  async syncProductAvailability(productId, isSoldOut) {
    return { provider: "demo-pospal", reference: reference("stock"), message: `Demo product ${productId} sold-out state synced: ${isSoldOut}` };
  },
};
