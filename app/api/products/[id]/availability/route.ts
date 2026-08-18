import { demoPospalAdapter } from "@/lib/adapters";
import { HttpError, jsonError, merchantActorFromRequest, readJson } from "@/lib/http";
import { recordIntegrationEvent, setProductSoldOut } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = merchantActorFromRequest(request);
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
