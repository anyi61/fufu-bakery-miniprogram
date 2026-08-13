import { demoPospalAdapter } from "@/lib/adapters";
import { MERCHANT_EMAIL, MERCHANT_ID } from "@/lib/domain";
import { actorFromRequest, HttpError, jsonError, readJson } from "@/lib/http";
import { recordIntegrationEvent, setProductSoldOut } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("x-xiaoyu-role") !== "merchant") throw new HttpError(403, "需要门店权限");
    const actor = actorFromRequest(request, { userId: MERCHANT_ID, email: MERCHANT_EMAIL });
    const body = await readJson<{ isSoldOut?: boolean }>(request);
    if (typeof body.isSoldOut !== "boolean") throw new HttpError(400, "isSoldOut 必须是布尔值");
    const { id } = await context.params;
    const product = await setProductSoldOut(Number(id), body.isSoldOut, actor);
    const result = await demoPospalAdapter.syncProductAvailability(product.id, product.isSoldOut);
    await recordIntegrationEvent(null, "pospal.product_availability", result);
    return Response.json({ product });
  } catch (error) {
    return jsonError(error);
  }
}
