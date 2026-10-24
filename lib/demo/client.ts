export async function demoPost<T = { ok: boolean }>(body: unknown): Promise<T> {
  const response = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Preview request failed.");
  return result;
}
