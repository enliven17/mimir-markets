import localFont from "next/font/local";

/**
 * Mimir type:
 * - Geist Pixel Square: UI voice (body, labels, stats). var --font-geist-pixel-square
 * - Terminal Grotesque: display (wordmark, headings, buttons), 400 only, SIL OFL
 *   (app/fonts/TERMINAL-GROTESQUE-LICENSE.md). var --font-terminal-grotesque
 * - Geist Mono: addresses, hex, ticking numbers. var --font-geist-mono
 *
 * Declared here from the geist package's files rather than through
 * `geist/font`: those modules declare every static weight and all five pixel
 * faces, and next/font preloads each of them (24 font requests racing the
 * page's script on every route). Only the two faces above the fold, the
 * display face and the body face, are preloaded; Mono is a single
 * variable file fetched when first used. All use font-display: swap.
 * (next/font needs literal options, so the fallback lists are spelled out.)
 */
export const fontDisplay = localFont({
  // WOFF2 of the original TTF (all 214 glyphs, 13KB).
  src: "../app/fonts/terminal-grotesque.woff2",
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

/** Every font variable class, for the <html> element. */
export const fontVariables = [
  fontPixel.variable,
  fontDisplay.variable,
  fontMono.variable,
].join(" ");
