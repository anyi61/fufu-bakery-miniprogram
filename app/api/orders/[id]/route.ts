import { CUSTOMER_EMAIL, CUSTOMER_ID } from "@/lib/domain";
import { actorFromRequest, jsonError, merchantActorFromRequest } from "@/lib/http";
import { getOrder } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = actorFromRequest(request, { userId: CUSTOMER_ID, email: CUSTOMER_EMAIL });
    const { id } = await context.params;
    const merchant = new URL(request.url).searchParams.get("surface") === "merchant";
    if (merchant) merchantActorFromRequest(request);
    return Response.json({ order: await getOrder(id, merchant ? undefined : actor.userId) });
  } catch (error) {
    return jsonError(error);
  }
}
