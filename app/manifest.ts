import type { MetadataRoute } from "next";

/** Installable app: the browser's "add to home screen" and the Android APK (a Trusted Web Activity) read this. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mimir Markets",
    short_name: "Mimir Markets",
    description: "Stake USDC on any claim. An AI oracle settles it in the open. Markets settle on Arc; your wallet lives on Solana.",
    start_url: "/en/arena",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#110f0e",
    theme_color: "#110f0e",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
