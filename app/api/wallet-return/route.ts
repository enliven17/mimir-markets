/**
 * GET /api/wallet-return?op=…: where Phantom and Solflare send their answer to a deeplink request (`redirect_link`,
 * lib/solana/deeplink-adapter.ts). Parks the answer for the page that asked (lib/server/wallet-relay.ts) and shows
 * a short "go back" page. In the Android app the app catches this link, forwards it here itself and closes, so the
 * page below never shows there; in a phone browser it is the new tab the wallet opened.
 */
import { pickParams, putRelay } from "@/lib/server/wallet-relay";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#110f0e"><meta name="robots" content="noindex"><title>Mimir: ${title}</title>
<style>html,body{margin:0;height:100%;background:#110f0e;color:#f3ead6;font:16px/1.5 system-ui,sans-serif}
main{min-height:100%;display:grid;place-content:center;gap:16px;padding:24px;text-align:center}
img{width:72px;height:72px;margin:0 auto;border-radius:22%}h1{margin:0;font-size:21px;font-weight:500}p{margin:0;color:#a89d93;max-width:300px}</style>
</head><body><main><img src="/app/icon-192.png" alt=""><h1>${title}</h1><p>${body}</p></main></body></html>`;

const html = (status: number, title: string, body: string) =>
  new Response(page(title, body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: Request) {
  if (!(await allowRequest("wallet-return", clientIp(req), 30, 60_000))) return html(429, "Too many requests", "Wait a moment and try again.");
  const url = new URL(req.url);
  const params = pickParams(url.searchParams);
  const op = url.searchParams.get("op") ?? "";
  if (!params || !(await putRelay(op, params).catch(() => false))) {
    return html(400, "Nothing to hand back", "This link has expired or was already used. Go back to Mimir and try again.");
  }
  const rejected = Boolean(params.errorCode);
  return html(200, rejected ? "Cancelled in your wallet" : "Done in your wallet", "Go back to the Mimir tab you came from. It picks this up on its own.");
}
