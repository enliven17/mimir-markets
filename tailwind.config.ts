import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";

const config: Config = {
  // Dark only. No `dark` class, no light theme.
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette; RGB triplets live on :root in app/globals.css.
        ink:            "rgb(var(--ink-rgb) / <alpha-value>)",
        "ink-deep":     "rgb(var(--ink-deep-rgb) / <alpha-value>)",
        panel:          "rgb(var(--panel-rgb) / <alpha-value>)",
        "panel-2":      "rgb(var(--panel-2-rgb) / <alpha-value>)",
        "panel-raised": "rgb(var(--panel-raised-rgb) / <alpha-value>)",
        maroon:         "rgb(var(--maroon-rgb) / <alpha-value>)",
        cream:          "rgb(var(--cream-rgb) / <alpha-value>)",
        muted:          "rgb(var(--muted-rgb) / <alpha-value>)",
        dim:            "rgb(var(--dim-rgb) / <alpha-value>)",
        // Keep Tailwind's red scale (red-400/500 are still used) next to the token.
        red:            { ...defaultColors.red, DEFAULT: "rgb(var(--red-rgb) / <alpha-value>)" },
        coral:          "rgb(var(--coral-rgb) / <alpha-value>)",
        "coral-hi":     "rgb(var(--coral-hi-rgb) / <alpha-value>)",
        deep:           "rgb(var(--deep-rgb) / <alpha-value>)",
        danger:         "rgb(var(--danger-rgb) / <alpha-value>)",
        win:            "rgb(var(--win-rgb) / <alpha-value>)",
        pending:        "rgb(var(--pending-rgb) / <alpha-value>)",
        line:           "rgb(var(--cream-rgb) / 0.12)",
        "line-strong":  "rgb(var(--cream-rgb) / 0.30)",
      },
      fontFamily: {
        // Geist Pixel Square is the UI voice, Terminal Grotesque the display
        // face (400 only, never bold), Geist Mono for addresses and numbers.
        sans:    ["var(--font-geist-pixel-square)", "var(--font-geist-mono)", "ui-monospace", "monospace"],
        body:    ["var(--font-geist-pixel-square)", "var(--font-geist-mono)", "ui-monospace", "monospace"],
        pixel:   ["var(--font-geist-pixel-square)", "var(--font-geist-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-terminal-grotesque)", "Arial Narrow", "Arial", "sans-serif"],
        mono:    ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // Landing scale (marketing pages, page heroes)
        "display-xl":   ["clamp(46px, 7.2vw, 104px)", { lineHeight: "0.95", letterSpacing: "-0.01em" }],
        "display-hero": ["clamp(24px, 5.8vw, 78px)",  { lineHeight: "0.95" }],
        "display-lg":   ["clamp(40px, 6vw, 76px)",    { lineHeight: "1", letterSpacing: "-0.01em" }],
        "display-md":   ["clamp(34px, 4vw, 46px)",    { lineHeight: "1" }],
        title:          ["28px", { lineHeight: "1.1" }],
        "title-sm":     ["24px", { lineHeight: "1.1" }],
        lead:           ["clamp(14px, 1.45vw, 20px)", { lineHeight: "1.45" }],
        sub:            ["17px", { lineHeight: "1.5" }],
        body:           ["16px", { lineHeight: "1.5", letterSpacing: "-0.01em" }],
        "card-title":   ["17px", { lineHeight: "1.3" }],
        small:          ["14px", { lineHeight: "1.45" }],
        "small-xs":     ["13px", { lineHeight: "1.45" }],
        micro:          ["12px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
        "micro-xs":     ["11px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
        stat:           ["18px", { lineHeight: "1.2" }],
        eyebrow:        ["14px", { lineHeight: "1.2" }],
        // App scale (dense screens)
        "app-h1":       ["clamp(1.85rem, 7vw, 2.8rem)", { lineHeight: "1", letterSpacing: "-0.02em" }],
        "app-hero":     ["clamp(2.15rem, 9vw, 3.8rem)", { lineHeight: "0.95", letterSpacing: "-0.07em" }],
        section:        ["clamp(1.8rem, 4vw, 3rem)",    { lineHeight: "0.94" }],
        status:         [".74rem",  { lineHeight: "1.2", letterSpacing: ".09em" }],
        copy:           [".86rem",  { lineHeight: "1.55" }],
        meta:           [".88rem",  { lineHeight: "1.45" }],
        button:         [".82rem",  { lineHeight: "1" }],
        "button-lg":    ["1.05rem", { lineHeight: "1" }],
        "label-xs":     [".7rem",   { lineHeight: "1.3" }],
      },
      // Round: pills for every control, soft cards.
      borderRadius: {
        DEFAULT: "8px",
        none:  "0px",
        xs:    "4px",
        sm:    "8px",
        md:    "12px",
        lg:    "16px",
        xl:    "20px",
        "2xl": "22px",
        "3xl": "28px",
        "4xl": "32px",
        full:  "999px",
      },
      boxShadow: {
        chip:    "inset 0 1px 0 rgb(255 255 255 / .06), 0 10px 30px rgb(0 0 0 / .22)",
        card:    "inset 0 1px 0 rgba(255,255,255,.07), 0 24px 60px -20px rgba(0,0,0,.6)",
        sheet:   "inset 0 1px 0 rgb(255 255 255 / .055), 0 28px 80px rgb(0 0 0 / .32)",
        shelf:   "inset 0 1px 0 rgb(255 255 255 / .055), 0 18px 54px rgb(0 0 0 / .28)",
        menu:    "0 14px 34px rgb(0 0 0 / .48)",
        modal:   "inset 0 1px 0 rgb(255 255 255 / .045), 0 28px 90px rgb(0 0 0 / .62)",
        primary: "0 10px 30px -12px rgba(255,81,72,.8), inset 0 1px 0 rgba(255,255,255,.25)",
        bubble:  "inset 0 1px 0 rgb(255 255 255 / .15), inset 0 -2px 5px rgb(0 0 0 / .2), 0 14px 30px rgb(0 0 0 / .32)",
        "bubble-hover": "inset 0 1px 0 rgb(255 255 255 / .24), inset 0 -2px 5px rgb(0 0 0 / .2), 0 22px 42px rgb(0 0 0 / .44)",
        well:    "inset 0 1px 5px rgb(0 0 0 / .42)",
      },
      transitionTimingFunction: {
        out:       "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out":  "cubic-bezier(0.77, 0, 0.175, 1)",
        spring:    "cubic-bezier(0.22, 1, 0.36, 1)",
        overshoot: "cubic-bezier(0.22, 1.25, 0.36, 1)",
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
          "0%, 100%": { boxShadow: "0 0 20px rgba(255,81,72,0.06)" },
          "50%":      { boxShadow: "0 0 50px rgba(255,81,72,0.18)" },
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
