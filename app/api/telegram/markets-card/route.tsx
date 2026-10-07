/**
 * GET /api/telegram/markets-card?t=<minute bucket>: the picture the Telegram /markets command is sent with. The
 * open markets closing soonest (up to four; the caption lists five), each with its question, the two stakes and the time left, in the
 * card style of app/api/telegram/card. `t` only busts Telegram's cache; the data is read fresh.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { openMarkets, timeLeft } from "@/lib/server/open-markets";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#110F0E";
const CREAM = "#F3EAD6";
const RED = "#FF2B2B";
const MUTED = "#A89D93";
const PANEL = "#1C1817";

const assets = Promise.all([
  readFile(join(process.cwd(), "lib/og/fonts/TerminalGrotesque.ttf")),
  readFile(join(process.cwd(), "lib/og/fonts/GeistPixel-Square.ttf")),
  readFile(join(process.cwd(), "lib/og/fonts/GeistMono-Regular.ttf")),
  readFile(join(process.cwd(), "lib/og/horn.png")),
]);

const clamp = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n - 1) > n * 0.6 ? s.lastIndexOf(" ", n - 1) : n - 1)}…`);

export async function GET(req: Request) {
  if (!(await allowRequest("markets-card", clientIp(req), 120, 60_000))) return new Response("slow down", { status: 429 });
  const [{ total, markets }, [display, pixel, mono, hornPng]] = await Promise.all([openMarkets(4), assets]);
  const horn = `data:image/png;base64,${hornPng.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: INK,
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(243,234,214,0.07) 1px, transparent 0), radial-gradient(ellipse 460px 380px at 1080px 90px, rgba(255,43,43,0.22), rgba(17,15,14,0) 70%)`,
          backgroundSize: "6px 6px, 100% 100%",
          padding: "48px 60px",
          color: CREAM,
          fontFamily: "Pixel",
        }}
      >
        <img src={horn} width={130} height={142} style={{ position: "absolute", right: 60, top: 34, opacity: 0.9 }} />
        <div style={{ display: "flex", alignItems: "center", fontFamily: "Mono", fontSize: 20, letterSpacing: 4, color: MUTED }}>
          <div style={{ width: 12, height: 12, backgroundColor: RED, marginRight: 14 }} />
          {`${total} OPEN · ARC · SOLANA`}
        </div>
        <div style={{ display: "flex", marginTop: 14, fontFamily: "Display", fontSize: 68, lineHeight: 1, color: RED }}>Open markets</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 24, gap: 12 }}>
          {markets.length === 0 ? (
            <div style={{ display: "flex", fontSize: 30, color: MUTED }}>Nothing open right now. Open the first one on mimirmarkets.xyz.</div>
          ) : (
            markets.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 18, backgroundColor: PANEL, borderRadius: 14, padding: "16px 20px" }}>
                <div style={{ display: "flex", width: 92, fontFamily: "Mono", fontSize: 18, color: MUTED }}>{m.id.toUpperCase()}</div>
                <div style={{ display: "flex", flex: 1, fontSize: 23, color: CREAM, whiteSpace: "nowrap", overflow: "hidden" }}>{clamp(m.question, 44)}</div>
                <div style={{ display: "flex", width: 200, justifyContent: "flex-end", fontFamily: "Mono", fontSize: 17, whiteSpace: "nowrap", color: MUTED }}>
                  {`${m.sideA.usdc} / ${m.sideB.usdc}`}
                </div>
                <div style={{ display: "flex", width: 100, justifyContent: "flex-end", fontFamily: "Mono", fontSize: 18, color: RED, whiteSpace: "nowrap" }}>{timeLeft(m.deadline)}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", fontFamily: "Mono", fontSize: 19, letterSpacing: 2, color: MUTED }}>
          <span>Don&apos;t argue. Settle.</span>
          <span style={{ color: CREAM }}>mimirmarkets.xyz/arena</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Display", data: display, style: "normal" },
        { name: "Pixel", data: pixel, style: "normal" },
        { name: "Mono", data: mono, style: "normal" },
      ],
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    },
  );
}
