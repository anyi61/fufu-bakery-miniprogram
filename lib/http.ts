export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "请求内容不是有效 JSON");
  }
}

export function actorFromRequest(request: Request, fallback: { userId: string; email: string }) {
  return {
    userId: request.headers.get("oai-authenticated-user-id") || fallback.userId,
    email: request.headers.get("oai-authenticated-user-email") || fallback.email,
  };
}
