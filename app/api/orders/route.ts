import { demoNotificationAdapter, demoPaymentAdapter, demoPospalAdapter } from "@/lib/adapters";
import { CUSTOMER_EMAIL, CUSTOMER_ID } from "@/lib/domain";
import { actorFromRequest, jsonError, readJson } from "@/lib/http";
import { confirmOrderPaid, recordIntegrationEvent, reserveOrder } from "@/lib/store";

type Payload = {
  slotId?: number;
  items?: Array<{ productId?: number; quantity?: number }>;
  customerName?: string;
  customerPhoneMasked?: string;
  remark?: string;
  idempotencyKey?: string;
};

export async function POST(request: Request) {
  try {
    const actor = actorFromRequest(request, { userId: CUSTOMER_ID, email: CUSTOMER_EMAIL });
    const body = await readJson<Payload>(request);
    const reserved = await reserveOrder({
      customerUserId: actor.userId,
      customerName: body.customerName?.trim() || "张女士",
      customerPhoneMasked: body.customerPhoneMasked?.trim() || "138 **** 0826",
      slotId: Number(body.slotId),
      items: (body.items || []).map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity) })),
      remark: body.remark?.trim() || "可颂请装纸袋",
      idempotencyKey: body.idempotencyKey?.trim() || "",
    }, actor);
    const paymentResult = await demoPaymentAdapter.createPayment(reserved.id, reserved.totalCents);
    await recordIntegrationEvent(reserved.id, "payment.confirm", paymentResult);
    const order = await confirmOrderPaid(reserved.id, actor);
    const [notificationResult, pospalResult] = await Promise.all([
      demoNotificationAdapter.sendOrderStatus(order.id, order.status),
      demoPospalAdapter.syncOrder(order.id),
    ]);
    await Promise.all([
      recordIntegrationEvent(order.id, "notification.order_status", notificationResult),
      recordIntegrationEvent(order.id, "pospal.order_sync", pospalResult),
    ]);
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
