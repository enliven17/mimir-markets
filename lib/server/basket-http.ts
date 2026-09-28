/** Response helpers shared by the /api/baskets routes: `{ ok, reason, message }` on failure. */

export function basketJson(body: unknown, init: { status?: number; cache?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", "cache-control": init.cache ?? "no-store" },
  });
}

export function basketFail(status: number, reason: string, message: string): Response {
  return basketJson({ ok: false, reason, message }, { status });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
