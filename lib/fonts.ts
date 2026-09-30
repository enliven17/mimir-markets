import localFont from "next/font/local";

/**
 * Mimir type:
 * - Geist Pixel Square: UI voice (body, labels, stats). var --font-geist-pixel-square
 * - Terminal Grotesque: display (wordmark, headings, buttons), 400 only, SIL OFL
 *   (app/fonts/TERMINAL-GROTESQUE-LICENSE.md). var --font-terminal-grotesque
 * - Geist Mono: addresses, hex, ticking numbers. var --font-geist-mono
 * - Geist Sans: fallback only. var --font-geist-sans
 *
 * Declared here from the geist package's files rather than through
 * `geist/font`: those modules declare every static weight and all five pixel
 * faces, and next/font preloads each of them (24 font requests racing the
 * page's script on every route). Only the two faces above the fold, the
 * display face and the body face, are preloaded; Mono and Sans are single
 * variable files fetched when first used. All use font-display: swap.
 * (next/font needs literal options, so the fallback lists are spelled out.)
 */
export const fontDisplay = localFont({
  src: "../app/fonts/terminal-grotesque.ttf",
  weight: "400",
  variable: "--font-terminal-grotesque",
  display: "swap",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const fontPixel = localFont({
  src: "../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2",
  weight: "500",
  variable: "--font-geist-pixel-square",
  display: "swap",
  fallback: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Roboto Mono", "Menlo", "Monaco", "Liberation Mono", "DejaVu Sans Mono", "Courier New", "monospace"],
  adjustFontFallback: false,
});

export const fontMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Roboto Mono", "Menlo", "Monaco", "Liberation Mono", "DejaVu Sans Mono", "Courier New", "monospace"],
  adjustFontFallback: false,
});

export const fontSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "sans-serif"],
  adjustFontFallback: false,
});

/** Every font variable class, for the <html> element. */
export const fontVariables = [
  fontPixel.variable,
  fontDisplay.variable,
  fontMono.variable,
  fontSans.variable,
].join(" ");
