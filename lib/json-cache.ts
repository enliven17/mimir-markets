/**
 * Last good body per URL, kept for the life of the tab.
 *
 * Client pages poll the same few endpoints (/api/arena/claims above all). With
 * this, a page you navigate to renders the last answer at once and refreshes
 * it in the background, instead of showing skeletons for a full round trip on
 * every visit. The body is kept as text so callers can compare a new answer
 * with the old one and skip a render when nothing changed.
 */
const bodies = new Map<string, string>();

/** The last body fetched for `url` in this tab, or null. */
export function cachedBody(url: string): string | null {
  return bodies.get(url) ?? null;
}

/** The last body for `url`, parsed, or null (also null if it no longer parses). */
export function cachedJson<T = unknown>(url: string): T | null {
  const body = bodies.get(url);
  if (body === undefined) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/**
 * GET `url` and remember the body when the response is OK. Uses the default
 * cache mode so the CDN's short `s-maxage` answers can serve it.
 */
export async function fetchBody(url: string, init?: { signal?: AbortSignal }): Promise<{ ok: boolean; body: string }> {
  const res = await fetch(url, { signal: init?.signal });
  const body = await res.text();
  if (res.ok) bodies.set(url, body);
  return { ok: res.ok, body };
}
