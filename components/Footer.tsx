"use client";

/**
 * Global footer.
 *
 * 1. Closer (home only): one huge line that reveals by line + a magnetic CTA.
 * 2. Columns: brand, Product, Explore, Build, Network (cluster, program, live
 *    slot rolling in while the footer is on screen). Every nav route is here.
 * 3. Fine print.
 * 4. Giant wordmark whose letters climb in once per entry (played, not
 *    scrubbed, so a letter is never left half-risen).
 * 5. Bottom line: "Beta · Devnet" and the info-modal buttons.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import { gsap, useGSAP } from "@/lib/motion";
import dynamic from "next/dynamic";
import Magnetic from "@/components/motion/Magnetic";
import RollingNumber from "@/components/motion/RollingNumber";
import Wordmark from "@/components/ui/Wordmark";
import InfoModal, { INFO_PANELS, type InfoPanel } from "./footer/InfoModal";
import { NAV_CTA, NAV_MORE_GROUPS, NAV_PRIMARY, type NavItem } from "./nav-items";
import { ExternalMark } from "@/components/ExternalMark";

// The closer is home-only; its SplitText reveal loads only there.
const SplitReveal = dynamic(() => import("@/components/motion/SplitReveal"));

const REPO_URL = "https://github.com/enliven17/mimir-solana";
const OPENAPI_URL = `${REPO_URL}/blob/main/docs/openapi-agent-v1.yaml`;
const CCTP_URL = "https://developers.circle.com/cctp";
// The VS market contract stands for "the program": every contract is listed on /docs.
const PROGRAM_ID = ARC.contracts.mimirV3 ?? "";
const PROGRAM_SHORT = PROGRAM_ID ? `${PROGRAM_ID.slice(0, 6)}…${PROGRAM_ID.slice(-4)}` : "-";
const PROGRAM_EXPLORER_URL = PROGRAM_ID ? arcExplorerUrl("address", PROGRAM_ID) : ARC.chain.explorer;
const MARK = "Mimir";
const SLOT_POLL_MS = 8_000;
const ARC_CLIENT = arcPublicClient();

const groupItems = (key: string) => NAV_MORE_GROUPS.find((g) => g.key === key)?.items ?? [];

const mimirItem = (key: string) => groupItems("mimir").filter((i) => i.key === key);

const PRODUCT: readonly NavItem[] = [NAV_PRIMARY[0], NAV_CTA, ...NAV_PRIMARY.slice(1), ...mimirItem("token")];
const EXPLORE: readonly NavItem[] = [...groupItems("strategies"), ...groupItems("data")];
const BUILD: readonly NavItem[] = [...groupItems("build").filter((i) => i.href !== "/agents"), ...mimirItem("terms")];

const formatSlot = (n: number) => Math.round(n).toLocaleString("en-US");

/** Latest Arc block, polled only while the footer is on screen. */
function useLiveSlot(target: React.RefObject<HTMLElement | null>): number | null {
  const [slot, setSlot] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const read = () =>
      // A background tab needs no live slot.
      !document.hidden &&
      ARC_CLIENT
        .getBlockNumber()
        .then((b) => !cancelled && setSlot(Number(b)))
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, SLOT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible]);

  return slot;
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title} className="footer-col">
      <h2 className="footer-col-title">{title}</h2>
      <ul className="grid gap-2">{children}</ul>
    </nav>
  );
}

export default function Footer() {
  const t = useTranslations("footer");
  const tn = useTranslations("nav");
  const pathname = usePathname();
  const rootRef = useRef<HTMLElement>(null);
  const [panel, setPanel] = useState<InfoPanel | null>(null);
  const slot = useLiveSlot(rootRef);
  const isHome = pathname === "/";

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".mark-char", {
          yPercent: 105,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.06,
          // fastScrollEnd: a fling past the footer finishes the climb at once
          // instead of leaving a tween running under the next frames.
          scrollTrigger: { trigger: ".footer-mark", start: "top 96%", toggleActions: "play none none reverse", fastScrollEnd: true },
        });
      });
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  const navLink = (item: NavItem) => (
    <li key={item.href}>
      <Link href={item.href} className="footer-link">
        {tn(`items.${item.key}.label`)}
      </Link>
    </li>
  );

  const external = (url: string, label: string) => (
    <li key={url}>
      <a href={url} target="_blank" rel="noreferrer" className="footer-link">
        {label}
        <ExternalMark className="ml-1 text-dim" />
        <span className="sr-only"> {t("external")}</span>
      </a>
    </li>
  );

  return (
    <>
      {isHome ? (
        <section aria-labelledby="footer-closer" className="footer-closer">
          <SplitReveal>
            <h2 id="footer-closer" className="text-display-xl">
              {t("closerTitle")}
            </h2>
          </SplitReveal>
          <Magnetic>
            <Link href="/arena" className="btn-primary !w-auto !px-8 !text-[21px] !text-white">
              {t("closerCta")}
              <ArrowRight size={18} aria-hidden />
            </Link>
          </Magnetic>
        </section>
      ) : null}

      <footer ref={rootRef} className="site-footer">
        <div className="footer-cols">
          <div className="footer-col footer-brand">
            <Link href="/" aria-label={tn("home")} className="w-fit rounded-xs">
              <Wordmark />
            </Link>
            <p className="max-w-[30ch] text-[14px] leading-[1.5] text-muted">{t("tagline")}</p>
          </div>

          <Column title={t("product")}>{PRODUCT.map(navLink)}</Column>
          <Column title={t("explore")}>{EXPLORE.map(navLink)}</Column>
          <Column title={t("build")}>
            {BUILD.map(navLink)}
            {external(OPENAPI_URL, t("openapi"))}
            {external(REPO_URL, t("github"))}
          </Column>

          <div className="footer-col">
            <h2 className="footer-col-title">{t("network")}</h2>
            <dl className="grid gap-2 text-[14px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("cluster")}</dt>
                <dd className="flex items-center gap-2 text-cream">
                  <span aria-hidden className="live-dot" />
                  {t("clusterValue")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("program")}</dt>
                <dd>
                  <a
                    href={PROGRAM_EXPLORER_URL}
                    target="_blank"
                    rel="noreferrer"
                    title={PROGRAM_ID}
                    aria-label={t("programAria", { id: PROGRAM_ID })}
                    className="footer-link font-mono text-[13px]"
                  >
                    {PROGRAM_SHORT}
                    <ExternalMark className="ml-1 text-dim" />
                  </a>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("token")}</dt>
                <dd>
                  <Link href="/token" className="footer-link">
                    {t("tokenValue")}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("rollup")}</dt>
                <dd>
                  <a href={CCTP_URL} target="_blank" rel="noreferrer" className="footer-link">
                    {t("rollupValue")}
                    <ExternalMark className="ml-1 text-dim" />
                  </a>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t("slot")}</dt>
                <dd className="text-cream">
                  {slot === null ? (
                    <span className="font-mono text-[13px] text-muted">…</span>
                  ) : (
                    <RollingNumber value={slot} format={formatSlot} flash className="text-[13px]" />
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="footer-fine">{t("finePrint")}</p>

        <div className="footer-mark" role="img" aria-label={MARK}>
          {[...MARK].map((c, i) => (
            <span key={i} className="mark-char" aria-hidden>
              {c}
            </span>
          ))}
        </div>

        <div className="footer-bottom">
          <span>{t("beta")}</span>
          <nav aria-label={t("infoNav")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {INFO_PANELS.map((key) => (
              <button key={key} type="button" onClick={() => setPanel(key)} className="footer-link">
                {t(key)}
              </button>
            ))}
            <Link href="/terms" className="footer-link">
              {t("terms")}
            </Link>
          </nav>
          <span className="text-dim">{t("license", { year: new Date().getFullYear() })}</span>
        </div>
      </footer>

      <InfoModal panel={panel} onClose={() => setPanel(null)} />
    </>
  );
}
