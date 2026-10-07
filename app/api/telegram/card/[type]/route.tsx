/**
 * GET /api/telegram/card/<type>?kind=vs|pool&id=N[&side=1|2]&v=<version>: the picture a Telegram market
 * notification is sent with (lib/server/telegram.ts sendPhotoTo). Types: new, proposed, won, lost, refunded,
 * cancelled. 1200×630 PNG in the brand: ink ground, cream type, one signal-red accent, the horn.
 * Market data comes from the backend index; the card shows nothing a market page does not.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { arcMarketDetail } from "@/lib/server/arc-index";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";
import { cardModel, parseCardQuery, type CardModel, type Tone } from "@/lib/telegram-card";

export const runtime = "nodejs";

const INK = "#110F0E";
const CREAM = "#F3EAD6";
const RED = "#FF2B2B";
const MUTED = "#A89D93";
const WIN = "#9FD6A8";
const PANEL = "#1C1817";

const asset = (path: string) => readFile(join(process.cwd(), path));
const assets = Promise.all([
  asset("lib/og/fonts/TerminalGrotesque.ttf"),
  asset("lib/og/fonts/GeistPixel-Square.ttf"),
  asset("lib/og/fonts/GeistMono-Regular.ttf"),
  asset("lib/og/horn.png"),
]);

const TONE: Record<Tone, string> = { accent: RED, win: WIN, muted: MUTED, cream: CREAM };

function Card({ c, horn }: { c: CardModel; horn: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: INK,
        backgroundImage: `radial-gradient(circle at 1px 1px, rgba(243,234,214,0.07) 1px, transparent 0), radial-gradient(ellipse 520px 420px at 1010px 330px, rgba(255,43,43,0.22), rgba(17,15,14,0) 70%)`,
        backgroundSize: "6px 6px, 100% 100%",
        padding: "56px 64px",
        color: CREAM,
        fontFamily: "Pixel",
      }}
    >
      <img src={horn} width={230} height={252} style={{ position: "absolute", right: 72, top: 110, opacity: 0.9 }} />
      <div style={{ display: "flex", flexDirection: "column", width: 800, height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", fontFamily: "Mono", fontSize: 20, letterSpacing: 4, color: MUTED }}>
          <div style={{ width: 12, height: 12, backgroundColor: RED, marginRight: 14 }} />
          {c.eyebrow}
        </div>
        <div style={{ display: "flex", marginTop: 22, fontFamily: "Display", fontSize: 92, lineHeight: 0.9, color: TONE[c.tone] }}>{c.headline}</div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 32, lineHeight: 1.3, color: CREAM, maxHeight: 126, overflow: "hidden" }}>{c.question}</div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 21, color: MUTED }}>{c.detail}</div>
        <div style={{ display: "flex", marginTop: "auto", gap: 18 }}>
          {c.sides.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                width: 391,
                padding: "16px 20px",
                borderRadius: 14,
                backgroundColor: PANEL,
                border: `2px solid ${s.lead ? RED : "rgba(243,234,214,0.12)"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Mono", fontSize: 15, letterSpacing: 2, color: s.lead ? RED : MUTED }}>
                <span>{i === 0 ? "SIDE A" : "SIDE B"}</span>
                <span>{s.tag ? s.tag.toUpperCase() : `${s.pct}%`}</span>
              </div>
              <div style={{ display: "flex", marginTop: 8, fontSize: 24, color: CREAM, height: 32, overflow: "hidden" }}>{s.label}</div>
              <div style={{ display: "flex", marginTop: 6, fontFamily: "Mono", fontSize: 22, color: s.lead ? CREAM : MUTED }}>{s.usdc} USDC</div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 64,
          bottom: 56,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          fontFamily: "Mono",
          fontSize: 17,
          color: MUTED,
          letterSpacing: 1,
        }}
      >
        {c.footer.map((line) => (
          <span key={line} style={{ marginTop: 4 }}>
            {line}
          </span>
        ))}
        <span style={{ marginTop: 10, color: CREAM }}>mimirmarkets.xyz</span>
      </div>
    </div>
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const q = parseCardQuery((await ctx.params).type, new URL(req.url).searchParams);
  if (!q) return new Response("bad card request", { status: 400 });
  if (!(await allowRequest("telegram-card", clientIp(req), 120, 60_000))) return new Response("slow down", { status: 429 });

  const market = await arcMarketDetail(q.kind, q.id).catch(() => null);
  if (!market) return new Response("no such market", { status: 404 });

  const [display, pixel, mono, hornPng] = await assets;
  const horn = `data:image/png;base64,${hornPng.toString("base64")}`;
  // A settled market's card never changes; an open one does as stakes come in.
  const final = q.type !== "new" && q.type !== "proposed";
  return new ImageResponse(<Card c={cardModel(q, market)} horn={horn} />, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Display", data: display, weight: 400, style: "normal" },
      { name: "Pixel", data: pixel, weight: 400, style: "normal" },
      { name: "Mono", data: mono, weight: 400, style: "normal" },
    ],
    headers: { "cache-control": final ? "public, max-age=86400, s-maxage=86400, immutable" : "public, max-age=60, s-maxage=300" },
  });
}
