import { demoNotificationAdapter, demoPospalAdapter, demoPrintAdapter } from "@/lib/adapters";
import { type OrderStatus } from "@/lib/domain";
import { jsonError, merchantActorFromRequest, readJson } from "@/lib/http";
import { recordIntegrationEvent, transitionOrder } from "@/lib/store";

type Payload = { nextStatus?: OrderStatus; pickupCode?: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = merchantActorFromRequest(request);
    const body = await readJson<Payload>(request);
    if (!body.nextStatus) throw new HttpError(400, "缺少目标状态");
    const { id } = await context.params;
    const order = await transitionOrder(id, body.nextStatus, actor, body.pickupCode);
    const results = await Promise.all([
      demoNotificationAdapter.sendOrderStatus(order.id, order.status),
      demoPospalAdapter.syncOrder(order.id),
      ...(order.status === "accepted" ? [demoPrintAdapter.printOrder(order.id)] : []),
    ]);
    await Promise.all(results.map((result, index) => recordIntegrationEvent(
      order.id,
      index === 0 ? "notification.order_status" : index === 1 ? "pospal.order_sync" : "printer.ticket",
      result,
    )));
    return Response.json({ order });
  } catch (error) {
    return jsonError(error);
  }
}
