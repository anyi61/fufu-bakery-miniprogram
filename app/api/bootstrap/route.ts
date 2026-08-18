import { CUSTOMER_EMAIL, CUSTOMER_ID } from "@/lib/domain";
import { actorFromRequest, jsonError, merchantActorFromRequest } from "@/lib/http";
import { getBootstrap } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const merchant = url.searchParams.get("surface") === "merchant";
    if (merchant) merchantActorFromRequest(request);
    const actor = actorFromRequest(request, { userId: CUSTOMER_ID, email: CUSTOMER_EMAIL });
    return Response.json(await getBootstrap(merchant ? undefined : actor.userId));
  } catch (error) {
    return jsonError(error);
  }
}
