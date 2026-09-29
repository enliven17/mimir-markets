import localFont from "next/font/local";
import { GeistMono, GeistSans } from "geist/font";
import { GeistPixelSquare } from "geist/font/pixel";

/**
 * Mimir type:
 * - Geist Pixel Square: UI voice (body, labels, stats). var --font-geist-pixel-square
 * - Terminal Grotesque: display (wordmark, headings, buttons), 400 only, SIL OFL
 *   (app/fonts/TERMINAL-GROTESQUE-LICENSE.md). var --font-terminal-grotesque
 * - Geist Mono: addresses, hex, ticking numbers. var --font-geist-mono
 * - Geist Sans: fallback only. var --font-geist-sans
 */
export const fontDisplay = localFont({
  src: "../app/fonts/terminal-grotesque.ttf",
  weight: "400",
  variable: "--font-terminal-grotesque",
  display: "swap",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const fontPixel = GeistPixelSquare;
export const fontMono = GeistMono;
export const fontSans = GeistSans;

/** Every font variable class, for the <html> element. */
export const fontVariables = [
  fontPixel.variable,
  fontDisplay.variable,
  fontMono.variable,
  fontSans.variable,
].join(" ");
