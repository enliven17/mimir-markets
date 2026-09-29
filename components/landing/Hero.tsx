"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { gsap, MOTION_OK_QUERY, useGSAP } from "@/lib/motion";
import { Magnetic, useDitherReveal } from "@/components/motion";
import Scribble from "./Scribble";
import { PixelArrow, PixelPlus } from "./icons";

// Canvas only exists in the browser; the headline never waits for it.
const HeroAscii = dynamic(() => import("@/components/HeroAscii"), { ssr: false });

/**
 * 1. Hero: one line of headline that dithers in, one line of copy, two
 * magnetic CTAs over the ASCII field. The copy drifts up and fades as the page
 * scrolls away. All text is in the server HTML.
 */
export default function Hero() {
  const t = useTranslations("home.hero");
  const root = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);

  useDitherReveal(copy);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        gsap.to(".l-hero-copy", {
          yPercent: -18,
          opacity: 0.15,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: 1 },
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="l-hero" aria-labelledby="hero-title">
      <div className="l-hero-field" aria-hidden>
        <HeroAscii />
      </div>
      <div ref={copy} className="l-hero-copy">
        <h1 id="hero-title" className="l-hero-title" data-dither data-cell="9" data-dur="1700" data-d="150">
          <span className="l-line">{t("titleLead")} </span>
          <span className="l-line">
            <span className="l-accent-word">
              {t("titleAccent")}
              <Scribble />
            </span>
          </span>
        </h1>
        <p className="l-hero-sub" data-dither data-d="900">
          {t("sub")}
        </p>
        <div className="l-cta-row" data-dither data-d="1150">
          <Magnetic>
            <Link href="/arena" className="btn-primary !w-auto">
              <PixelArrow size={18} />
              {t("enter")}
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/arena/create" className="btn-ghost !w-auto">
              <PixelPlus size={18} />
              {t("create")}
            </Link>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
