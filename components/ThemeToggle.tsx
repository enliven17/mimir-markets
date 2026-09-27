"use client";

/**
 * Light/dark toggle. The actual `dark` class on <html> is set before paint by
 * the inline script in the root layout (no flash); this button just flips it
 * and persists the choice to localStorage.
 */
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mimir-theme", next ? "dark" : "light");
    } catch {
      /* private mode — fall back to in-session only */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-pv-border/25 bg-pv-surface/60 text-pv-text/80 transition-colors hover:border-pv-emerald/40 hover:text-pv-emerald focus-ring"
    >
      {/* Avoid an icon mismatch before mount: render the moon as a neutral default */}
      {mounted && dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
