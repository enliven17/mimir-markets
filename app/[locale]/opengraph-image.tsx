/**
 * The site's share card (Open Graph and Twitter), inherited by every page that has no image of its own. Same
 * fonts and horn as the Telegram cards (lib/og).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Mimir Markets: prediction markets on any claim, settled by AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const [display, pixel, mono, horn] = await Promise.all([
    // Literal paths, so the build traces just these four files.
    readFile(join(process.cwd(), "lib/og/fonts/TerminalGrotesque.ttf")),
    readFile(join(process.cwd(), "lib/og/fonts/GeistPixel-Square.ttf")),
    readFile(join(process.cwd(), "lib/og/fonts/GeistMono-Regular.ttf")),
    readFile(join(process.cwd(), "lib/og/horn.png")),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#110F0E",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(243,234,214,0.07) 1px, transparent 0), radial-gradient(ellipse 560px 460px at 960px 320px, rgba(255,43,43,0.24), rgba(17,15,14,0) 70%)",
          backgroundSize: "6px 6px, 100% 100%",
          padding: "72px 80px",
          color: "#F3EAD6",
          fontFamily: "Pixel",
        }}
      >
        <img src={`data:image/png;base64,${horn.toString("base64")}`} width={300} height={329} style={{ position: "absolute", right: 90, top: 150 }} />
        <div style={{ display: "flex", flexDirection: "column", width: 720, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Mono", fontSize: 22, letterSpacing: 5, color: "#A89D93" }}>
            <div style={{ width: 12, height: 12, backgroundColor: "#FF2B2B", marginRight: 16 }} />
            MIMIR MARKETS
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 34, fontFamily: "Display", fontSize: 124, lineHeight: 0.9 }}>
            <span>Don&apos;t argue.</span>
            <span style={{ color: "#FF2B2B" }}>Settle.</span>
          </div>
          <div style={{ display: "flex", marginTop: 36, fontSize: 32, lineHeight: 1.35, color: "#A89D93" }}>
            Stake USDC on any claim. An AI oracle settles it in the open, on Arc, funded from Solana.
          </div>
          <div style={{ display: "flex", marginTop: "auto", fontFamily: "Mono", fontSize: 24, letterSpacing: 2 }}>mimirmarkets.xyz</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Display", data: display, style: "normal", weight: 400 },
        { name: "Pixel", data: pixel, style: "normal", weight: 400 },
        { name: "Mono", data: mono, style: "normal", weight: 400 },
      ],
    },
  );
}
