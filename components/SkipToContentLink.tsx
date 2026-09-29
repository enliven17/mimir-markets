"use client";

/**
 * First stop in the tab order: jumps past the header to <main>. Hidden until
 * focused, then a coral pill over the top-left corner. Scrolls through Lenis
 * when it runs and never leaves `#main-content` in the URL (a reload would
 * otherwise jump there).
 */
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getLenis } from "@/lib/motion";

export default function SkipToContentLink() {
  const t = useTranslations("common");

  const handleSkip = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const main = document.getElementById("main-content");
    if (!main) return;
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(main, { offset: -80, immediate: true, force: true });
    else window.scrollTo({ top: Math.max(0, main.getBoundingClientRect().top + window.scrollY - 80) });
    main.focus({ preventScroll: true });
  }, []);

  return (
    <a
      href="#main-content"
      onClick={handleSkip}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-[calc(14px+env(safe-area-inset-top))] focus:z-[100] focus:inline-flex focus:min-h-[40px] focus:items-center focus:rounded-full focus:bg-coral focus:px-5 focus:font-display focus:text-[1.05rem] focus:text-[#160909] focus:shadow-primary"
    >
      {t("skipToContent")}
    </a>
  );
}
