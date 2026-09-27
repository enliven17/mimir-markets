import type { Config } from "tailwindcss";

const config: Config = {
  // Class-based dark mode: the `dark` class on <html> is set before paint by
  // the inline script in app/layout.tsx (dark is the default) and flipped by
  // ThemeToggle. Never auto-triggered from the OS preference.
  darkMode: "class",
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Purple blueprint palette, driven by CSS variables (RGB triplets in
        // app/globals.css) so the same `pv-*` utilities switch between light
        // and dark via the `dark` class on <html>. `border` is the ink colour
        // (white on dark, violet on light) — use it at /25 for hairlines.
        // Legacy accent names (cyan/fuch/emerald) resolve to the Solana
        // purple family; `gold` is the Solana green (money figures only).
        pv: {
          bg:       "rgb(var(--pv-bg) / <alpha-value>)",
          surface:  "rgb(var(--pv-surface) / <alpha-value>)",
          surface2: "rgb(var(--pv-surface2) / <alpha-value>)",
          border:   "rgb(var(--pv-border) / <alpha-value>)",
          text:     "rgb(var(--pv-text) / <alpha-value>)",
          muted:    "rgb(var(--pv-muted) / <alpha-value>)",
          cyan:     "rgb(var(--pv-accent) / <alpha-value>)",
          fuch:     "rgb(var(--pv-accent2) / <alpha-value>)",
          emerald:  "rgb(var(--pv-accent) / <alpha-value>)",
          gold:     "rgb(var(--pv-gold) / <alpha-value>)",
          danger:   "rgb(var(--pv-danger) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["'Maple Mono'", "var(--font-display)", "ui-monospace", "monospace"],
        body:    ["'Maple Mono'", "var(--font-body)",    "ui-monospace", "monospace"],
        mono:    ["'Maple Mono'", "var(--font-mono)",    "ui-monospace", "monospace"],
      },
      // Blueprint look: sharp corners everywhere. Pills/dots/avatars keep
      // their roundness via `rounded-full`.
      borderRadius: {
        DEFAULT: "0px",
        none:  "0px",
        sm:    "0px",
        md:    "0px",
        lg:    "0px",
        xl:    "0px",
        "2xl": "0px",
        "3xl": "0px",
        "4xl": "0px",
        full:  "9999px",
      },
      boxShadow: {
        glow:           "0 0 40px rgba(153,69,255,0.32)",
        "glow-fuch":    "0 0 40px rgba(153,69,255,0.28)",
        "glow-emerald": "0 0 40px rgba(153, 69, 255,0.18)",
        "glow-gold":    "0 0 40px rgba(20,241,149,0.12)",
        "glow-lg":      "0 0 60px rgba(153,69,255,0.36)",
        "glow-fuch-lg": "0 0 60px rgba(153,69,255,0.32)",
        "glow-emerald-lg": "0 0 60px rgba(153, 69, 255,0.22)",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        stampIn: {
          "0%":   { opacity: "0", transform: "scale(2.5) rotate(-12deg)" },
          "50%":  { opacity: "1", transform: "scale(0.95) rotate(-12deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-12deg)" },
        },
        confDrop: {
          "0%":   { opacity: "1", transform: "translateY(0) rotate(0deg)" },
          "100%": { opacity: "0", transform: "translateY(100vh) rotate(600deg)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(20,241,149,0.06)" },
          "50%":      { boxShadow: "0 0 50px rgba(20,241,149,0.18)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        countRoll: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%":      { transform: "translateY(-6px)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        /* ── Ritual system ── */
        fuseDecay: {
          "0%":   { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        phaseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%":      { opacity: "1" },
        },
        tensionPulse: {
          "0%, 100%": { opacity: "0.2", transform: "scaleY(0.95)" },
          "50%":      { opacity: "0.6", transform: "scaleY(1)" },
        },
        sealFlash: {
          "0%":   { opacity: "0", transform: "scale(1.8) rotate(-8deg)" },
          "40%":  { opacity: "1", transform: "scale(0.96) rotate(-8deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-8deg)" },
        },
        tickDown: {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up":    "fadeUp 0.5s ease-out both",
        "fade-in":    "fadeIn 0.3s ease-out both",
        "stamp-in":   "stampIn 0.6s ease-out both",
        "conf-drop":  "confDrop 2s ease-in forwards",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        blink:        "blink 1s step-end infinite",
        "count-roll": "countRoll 0.4s ease-out both",
        shimmer:      "shimmer 2s linear infinite",
        float:        "float 3s ease-in-out infinite",
        "spin-slow":  "spin-slow 8s linear infinite",
        /* ── Ritual system ── */
        "fuse-decay":     "fuseDecay 2s linear infinite",
        "phase-glow":     "phaseGlow 2s ease-in-out infinite",
        "tension-pulse":  "tensionPulse 2.5s ease-in-out infinite",
        "seal-flash":     "sealFlash 0.55s ease-out both",
        "tick-down":      "tickDown 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
