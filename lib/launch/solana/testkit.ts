// Test helpers for the Privy client (from snipad's lib/server/solana/testkit.ts): a fetch that records its calls.
type Call = { url: string; init: RequestInit; body: unknown };

export function recordingFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const raw = init.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw;
    const call = { url, init, body };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
