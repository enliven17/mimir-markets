/**
 * GET /api/og/invite?code=<code>&v=<version>: the X card for a shared invite (lib/invite-share.ts). 1200×630 PNG in
 * the brand: ink ground, the horn, the code on a cream ticket. Only well-formed codes render; anything else is 404,
 * so the card can never carry arbitrary text. Codes are not looked up: a used code still renders (the page says so).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { inviteKind } from "@/lib/invite-share";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const INK = "#110F0E";
const CREAM = "#F3EAD6";
const RED = "#FF2B2B";
const MUTED = "#A89D93";

// Literal paths, so the build traces just these files.
const assets = Promise.all([
  readFile(join(process.cwd(), "lib/og/fonts/TerminalGrotesque.ttf")),
  readFile(join(process.cwd(), "lib/og/fonts/GeistPixel-Square.ttf")),
  readFile(join(process.cwd(), "lib/og/fonts/GeistMono-Regular.ttf")),
  readFile(join(process.cwd(), "lib/og/horn.png")),
]);

export async function GET(req: Request) {
  const parsed = inviteKind(new URL(req.url).searchParams.get("code") ?? "");
  if (!parsed) return new Response("not found", { status: 404 });
  if (!(await allowRequest("og-invite", clientIp(req), 120, 60_000))) return new Response("slow down", { status: 429 });
  const [display, pixel, mono, hornPng] = await assets;
  const horn = `data:image/png;base64,${hornPng.toString("base64")}`;
  const access = parsed.kind === "access";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: INK,
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(243,234,214,0.07) 1px, transparent 0), radial-gradient(ellipse 560px 460px at 1000px 300px, rgba(255,43,43,0.24), rgba(17,15,14,0) 70%)`,
          backgroundSize: "6px 6px, 100% 100%",
          padding: "60px 68px",
          color: CREAM,
          fontFamily: "Pixel",
        }}
      >
        <img src={horn} width={250} height={274} style={{ position: "absolute", right: 80, top: 96, opacity: 0.92 }} />
        <div style={{ display: "flex", flexDirection: "column", width: 780, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Mono", fontSize: 20, letterSpacing: 4, color: MUTED }}>
            <div style={{ width: 12, height: 12, backgroundColor: RED, marginRight: 14 }} />
            {access ? "INVITE-ONLY · ARC · SOLANA" : "LEADERBOARD · ARC · SOLANA"}
          </div>
          <div style={{ display: "flex", marginTop: 26, fontFamily: "Display", fontSize: 104, lineHeight: 0.9 }}>
            {access ? "You're invited." : "Join me on Mimir."}
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 30, lineHeight: 1.35, color: MUTED, width: 720 }}>
            {access ? "Claims, settled by AI. Your code gets you in; no $MIMIR needed." : "Claims, settled by AI. My code gives you a points boost."}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: "auto", gap: 24 }}>
            <div
              style={{
                display: "flex",
                padding: "18px 30px",
                borderRadius: 18,
                backgroundColor: CREAM,
                color: INK,
                fontFamily: "Mono",
                fontSize: access ? 46 : 52,
                letterSpacing: 4,
                boxShadow: "0 0 60px rgba(255,43,43,0.35)",
              }}
            >
              {parsed.code}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, fontFamily: "Mono", fontSize: 20, letterSpacing: 2, color: MUTED, width: 1064 }}>
            <span>Don&apos;t argue. Settle.</span>
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
      headers: { "cache-control": "public, max-age=86400, s-maxage=86400, immutable" },
    },
  );
}
