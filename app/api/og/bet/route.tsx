/**
 * GET /api/og/bet?kind=vs|pool&id=N&side=1|2&v=<version>: the X card for a shared bet (lib/bet-share.ts). 1200×630
 * PNG in the brand: the question, "I took <side>" and both sides' stakes from the backend index. Unknown markets 404.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { parseBetRef } from "@/lib/bet-share";
import { arcMarketDetail } from "@/lib/server/arc-index";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

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

const usdc = (wei: string) => (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(2);
const clamp = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n - 1) > n * 0.6 ? s.lastIndexOf(" ", n - 1) : n - 1)}…`);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = parseBetRef(`${sp.get("kind")}-${sp.get("id")}`, sp.get("side"));
  if (!q) return new Response("bad request", { status: 400 });
  if (!(await allowRequest("og-bet", clientIp(req), 120, 60_000))) return new Response("slow down", { status: 429 });
  const m = (await arcMarketDetail(q.kind, q.id).catch(() => null)) as {
    question: string; labelA: string; labelB: string; stakeA: string; stakeB: string; participants: number; category: string;
  } | null;
  if (!m) return new Response("not found", { status: 404 });
  const [display, pixel, mono, hornPng] = await assets;
  const horn = `data:image/png;base64,${hornPng.toString("base64")}`;
  const mine = q.side === 1 ? m.labelA : m.labelB;
  const sides = [
    { label: m.labelA, usd: usdc(m.stakeA), on: q.side === 1 },
    { label: m.labelB, usd: usdc(m.stakeB), on: q.side === 2 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: INK,
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(243,234,214,0.07) 1px, transparent 0), radial-gradient(ellipse 520px 420px at 1010px 300px, rgba(255,43,43,0.24), rgba(17,15,14,0) 70%)`,
          backgroundSize: "6px 6px, 100% 100%",
          padding: "56px 64px",
          color: CREAM,
          fontFamily: "Pixel",
        }}
      >
        <img src={horn} width={210} height={230} style={{ position: "absolute", right: 76, top: 92, opacity: 0.9 }} />
        <div style={{ display: "flex", flexDirection: "column", width: 820, height: "100%" }}>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 20, letterSpacing: 4, color: MUTED }}>
            {`${q.kind.toUpperCase()} #${q.id} · ${m.category.toUpperCase()}`}
          </div>
          <div style={{ display: "flex", marginTop: 20, fontFamily: "Display", fontSize: 84, lineHeight: 0.92 }}>
            I took <span style={{ color: RED, marginLeft: 22 }}>{clamp(mine, 18)}</span>
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, lineHeight: 1.3, color: CREAM, maxHeight: 126, overflow: "hidden" }}>
            {clamp(m.question, 120)}
          </div>
          <div style={{ display: "flex", marginTop: "auto", gap: 18 }}>
            {sides.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: 380,
                  padding: "18px 22px",
                  borderRadius: 18,
                  backgroundColor: PANEL,
                  border: `2px solid ${s.on ? RED : "rgba(243,234,214,0.12)"}`,
                }}
              >
                <div style={{ display: "flex", fontFamily: "Mono", fontSize: 16, letterSpacing: 3, color: s.on ? RED : MUTED }}>{s.on ? "MY SIDE" : "THE OTHER SIDE"}</div>
                <div style={{ display: "flex", marginTop: 8, fontSize: 26, color: CREAM, whiteSpace: "nowrap", overflow: "hidden" }}>{clamp(s.label, 24)}</div>
                <div style={{ display: "flex", marginTop: 6, fontFamily: "Mono", fontSize: 22, color: MUTED }}>{`${s.usd} USDC`}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, fontFamily: "Mono", fontSize: 19, letterSpacing: 2, color: MUTED, width: 1072 }}>
            <span>Think I&apos;m wrong? Take the other side.</span>
            <span style={{ color: CREAM }}>mimirmarkets.xyz</span>
          </div>
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
      headers: { "cache-control": "public, max-age=300, s-maxage=300" },
    },
  );
}
