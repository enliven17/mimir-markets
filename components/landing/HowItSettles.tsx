"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { gsap, MOTION_OK_QUERY, pinType, useGSAP } from "@/lib/motion";
import { requestScrollRefresh } from "./LandingFeed";

const STEPS = ["create", "challenge", "resolve", "payout"] as const;

/**
 * 3. How it settles: four steps, one sentence each. With motion the section
 * pins and a scrubbed timeline walks the steps and rolls the big numeral,
 * snapping to the nearest step (the numeral already says which step it is,
 * so there is no separate progress path). Without it (no JS, reduced
 * motion) the steps are a plain numbered list; the pinned layout only exists
 * while `data-pinned` is set by the timeline below.
 */
export default function HowItSettles() {
  const t = useTranslations("home.how");
  const root = useRef<HTMLElement>(null);
  const n = STEPS.length;

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        el.setAttribute("data-pinned", "");
        gsap.set(".l-how-step:not(:first-child)", { yPercent: 40, opacity: 0 });
        const tl = gsap.timeline({
          defaults: { ease: "power3.inOut", duration: 1 },
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: `+=${(n - 1) * 110}%`,
            scrub: 1.2,
            pin: true,
            pinType: pinType(),
            anticipatePin: 1,
            // Nearest step, not the next one: a small scroll never jumps a whole step.
            snap: {
              snapTo: 1 / (n - 1),
              directional: false,
              delay: 0.2,
              duration: { min: 0.5, max: 1 },
              ease: "power2.inOut",
            },
          },
        });
        for (let i = 1; i < n; i++) {
          tl.to(".l-how-digits", { yPercent: (-100 / n) * i }, i - 1)
            .to(`.l-how-step:nth-child(${i})`, { yPercent: -40, opacity: 0 }, i - 1)
            .to(`.l-how-step:nth-child(${i + 1})`, { yPercent: 0, opacity: 1 }, i - 0.8);
        }
        // The layout just changed from a list to a stage: re-measure what follows.
        requestScrollRefresh();
        return () => {
          el.removeAttribute("data-pinned");
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    // The wrapper keeps GSAP's pin spacer out of React's sibling list.
    <div>
      <section ref={root} className="l-how l-section" aria-labelledby="how-title">
        <div className="l-wrap">
          <h2 className="eyebrow l-eyebrow" id="how-title">
            {t("eyebrow")}
          </h2>
          <div className="l-how-stage">
            <div className="l-how-numeral" aria-hidden>
              <div className="l-how-digits">
                {STEPS.map((s, i) => (
                  <span key={s}>{i + 1}</span>
                ))}
              </div>
            </div>
            <ol className="l-how-steps">
              {STEPS.map((s, i) => (
                <li key={s} className="l-how-step">
                  <span className="l-how-n" aria-hidden>
                    {i + 1}
                  </span>
                  <h3>
                    <span className="sr-only">{t("stepOf", { n: i + 1, total: n })}: </span>
                    {t(`steps.${s}.title`)}
                    <span className="l-accent">.</span>
                  </h3>
                  <p>{t(`steps.${s}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
