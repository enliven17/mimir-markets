"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getLenis, gsap, MOTION_OK_QUERY, pinType, ScrollTrigger, useGSAP } from "@/lib/motion";
import { SplitReveal, useRiseBatch } from "@/components/motion";
import Segmented from "@/components/ui/Segmented";
import { featuredClaim, poolUsdc } from "@/lib/landing";
import { formatUsdcBare } from "@/lib/money";
import { requestScrollRefresh, useLandingFeed } from "./LandingFeed";
import { PixelArrow } from "./icons";

type Tab = "stake" | "council";
const TABS: Tab[] = ["stake", "council"];
const MOCK_STEPS = ["connect", "deposit", "delegate", "stake"] as const;

interface Persona {
  slug: string;
  displayName: string;
  emoji: string;
  track: string;
}

type Roster = { status: "loading" } | { status: "ready"; personas: Persona[] } | { status: "error" };

function useRoster(): Roster {
  const [roster, setRoster] = useState<Roster>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/council/roster", { signal: controller.signal })
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { personas?: Persona[] } }) => {
        const personas = j.success ? j.data?.personas ?? [] : null;
        setRoster(personas && personas.length > 0 ? { status: "ready", personas } : { status: "error" });
      })
      .catch(() => !controller.signal.aborted && setRoster({ status: "error" }));
    return () => controller.abort();
  }, []);
  return roster;
}

function StakePane() {
  const t = useTranslations("home.dial");
  const tc = useTranslations("home.claim");
  const { feed } = useLandingFeed();
  const claim = featuredClaim(feed);

  return (
    <figure className="m-0" aria-label={t("mockLabel")}>
      <div className="l-mock" aria-hidden>
        {claim ? (
          <p className="l-mock-q">{claim.question}</p>
        ) : (
          <p className="l-mock-q text-muted">{t("mockEmpty")}</p>
        )}
        <div className="segmented" style={{ "--n": 2, "--i": 1 } as React.CSSProperties}>
          <button type="button" tabIndex={-1}>
            {tc("creator")}
          </button>
          <button type="button" tabIndex={-1} aria-pressed="true">
            {tc("challengers")}
          </button>
        </div>
        <div className="l-mock-row">
          <span className="k">{t("mockPool")}</span>
          <span className="font-mono text-[22px] leading-none text-cream">
            {claim ? formatUsdcBare(poolUsdc(claim)) : "—"} <small className="text-[12px] text-muted">USDC</small>
          </span>
        </div>
        <div className="l-mock-btn">{t("mockPick")}</div>
        <div className="progress-steps" data-mock-steps>
          {MOCK_STEPS.map((s) => (
            <span key={s}>{t(`mockSteps.${s}`)}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

function CouncilPane({ roster }: { roster: Roster }) {
  const t = useTranslations("home.dial");
  const personas = roster.status === "ready" ? roster.personas : [];
  const tracks = ["classic", "philosopher"] as const;

  return (
    <div className="l-mock">
      <div className="l-mock-row">
        <span className="k">{t("rosterLabel")}</span>
        <span className="text-cream">
          {roster.status === "ready" ? t("personas", { count: personas.length }) : "—"}
        </span>
      </div>
      {roster.status === "error" ? (
        <p className="m-0 text-[14px] text-muted">{t("rosterError")}</p>
      ) : (
        <ul className="l-roster" aria-label={t("rosterLabel")} aria-busy={roster.status === "loading" || undefined}>
          {roster.status === "ready"
            ? personas.map((p) => (
                <li key={p.slug} data-track={p.track} title={p.displayName}>
                  <span aria-hidden>{p.emoji}</span>
                  <span className="sr-only">{p.displayName}</span>
                </li>
              ))
            : Array.from({ length: 10 }, (_, i) => <li key={i} className="l-roster-skel" aria-hidden />)}
        </ul>
      )}
      <div className="l-legend">
        {tracks.map((track) => (
          <span key={track}>
            <i data-track={track} aria-hidden />
            {t(`tracks.${track}`)}
            {roster.status === "ready" ? (
              <span className="font-mono text-[12px] text-dim">
                {personas.filter((p) => p.track === track).length}
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 5. The council dial: "Stake a side" or "Let the council decide". With
 * motion the section is tall and its inner stage sticks; scrolling through it
 * turns the dial from one pane to the other and fills the meter, and the tabs
 * scroll to the matching half. Without motion both panes sit side by side.
 */
export default function CouncilDial() {
  const t = useTranslations("home.dial");
  const roster = useRoster();
  const root = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<Tab>("stake");
  const tabRef = useRef<Tab>("stake");

  useRiseBatch(root);

  const select = useCallback((next: Tab) => {
    tabRef.current = next;
    setTab(next);
  }, []);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        el.setAttribute("data-dial", "");
        const meter = el.querySelector<HTMLElement>(".l-dial-meter i");
        const steps = gsap.utils.toArray<HTMLElement>("[data-mock-steps] > span", el);
        const st = ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: "+=130%",
          pin: true,
          pinType: pinType(),
          anticipatePin: 1,
          onUpdate: (self) => {
            const p = self.progress;
            if (meter) meter.style.transform = `scaleX(${p.toFixed(3)})`;
            const done = Math.floor(Math.min(1, p / 0.45) * MOCK_STEPS.length);
            steps.forEach((s, i) => s.toggleAttribute("data-done", i < done));
            const next: Tab = p < 0.5 ? "stake" : "council";
            if (next !== tabRef.current) select(next);
          },
        });
        requestScrollRefresh();
        return () => {
          st.kill();
          el.removeAttribute("data-dial");
          steps.forEach((s) => s.removeAttribute("data-done"));
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Tabs move the page to the matching half so the scroll and the dial agree.
  const onTab = (next: Tab) => {
    select(next);
    const el = root.current;
    if (!el?.hasAttribute("data-dial")) return;
    const st = ScrollTrigger.getAll().find((s) => s.trigger === el);
    if (!st) return;
    const top = st.start + (st.end - st.start) * (next === "stake" ? 0.2 : 0.75);
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(top, { duration: 1 });
    else window.scrollTo({ top, behavior: "auto" });
  };

  const count = roster.status === "ready" ? roster.personas.length : null;

  return (
    // The wrapper keeps GSAP's pin spacer out of React's sibling list.
    <div>
    <section ref={root} className="l-dial l-section" aria-labelledby="dial-title">
      <div className="l-wrap l-dial-sticky">
        <div className="l-dial-copy">
          <p className="eyebrow l-eyebrow" data-rise>
            {t("eyebrow")}
          </p>
          <SplitReveal>
            <h2 id="dial-title" className="l-h2">
              {t("title")} <span className="l-accent">{t("titleAccent")}</span>
            </h2>
          </SplitReveal>
          <Segmented<Tab>
            className="l-dial-tabs"
            label={t("tabsLabel")}
            value={tab}
            onChange={onTab}
            options={TABS.map((v) => ({ value: v, label: t(v) }))}
          />
          <p className="l-sub l-dial-sub" aria-live="polite">
            {tab === "stake"
              ? t("stakeSub")
              : count
                ? t("councilSub", { count })
                : t("councilSubLoading")}
          </p>
          <div className="l-dial-meter" aria-hidden>
            <i />
          </div>
          <Link href={tab === "stake" ? "/arena" : "/council"} className="l-link">
            {tab === "stake" ? t("openArena") : t("openCouncil")}
            <PixelArrow size={14} />
          </Link>
        </div>
        <div className="l-dial-stage">
          <div className="l-pane fade-rise" data-on={tab === "stake" || undefined} data-rise>
            <h3 className="l-pane-title">{t("stake")}</h3>
            <p className="l-pane-sub">{t("stakeSub")}</p>
            <StakePane />
            <Link href="/arena" className="l-link l-pane-link">
              {t("openArena")}
              <PixelArrow size={14} />
            </Link>
          </div>
          <div className="l-pane fade-rise" data-on={tab === "council" || undefined} data-rise>
            <h3 className="l-pane-title">{t("council")}</h3>
            <p className="l-pane-sub">{count ? t("councilSub", { count }) : t("councilSubLoading")}</p>
            <CouncilPane roster={roster} />
            <Link href="/council" className="l-link l-pane-link">
              {t("openCouncil")}
              <PixelArrow size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
    </div>
  );
}
