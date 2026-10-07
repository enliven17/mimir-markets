"use client";

/**
 * /council on Arc: the totals strip, the oracle, then both juries. Each
 * persona bets from its own Circle wallet on Arc and keeps its Solana
 * identity; the card shows both. Records and stakes come live from the Convex
 * index (convex/arcViews.ts), bankrolls straight from the Arc RPC.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import type { Address } from "viem";

import { COUNCIL_PERSONAS, trackOf } from "@/agents/council/personas";
import { api } from "@/convex/_generated/api";
import { SURFACE } from "@/components/arena/surface";
import CouncilRoster, { type RosterPersona } from "@/components/council/CouncilRoster";
import PeepAvatar from "@/components/ui/PeepAvatar";
import Skeleton from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import { Strip, StripCell } from "@/components/ui/Strip";
import { arcPublicClient } from "@/lib/arc/chain";
import { arcExplorerUrl } from "@/lib/arc/config";
import { formatUsdcUnitsBare } from "@/lib/money";

/** 18-dp wei (string) → the 6-dp units the roster formats. */
const units = (wei: string | bigint) => (BigInt(wei) / 1_000_000_000_000n).toString();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ArcCouncil({ solana }: { solana: Record<string, string> }) {
  const t = useTranslations("council");
  const council = useQuery(api.arcViews.council, {});
  const oracle = useQuery(api.arcViews.oracle, {});
  const bankrolls = useBankrolls(council?.map((c) => c.address as Address));

  const personas: RosterPersona[] = useMemo(() => {
    const byslug = new Map((council ?? []).map((c) => [c.slug, c]));
    return COUNCIL_PERSONAS.map((p) => {
      const c = byslug.get(p.slug);
      return {
        slug: p.slug,
        displayName: p.displayName,
        bio: p.bio,
        archetype: p.archetype,
        track: trackOf(p),
        address: solana[p.slug] ?? "",
        arcAddress: c?.address,
        categoryFilter: p.categoryFilter,
        bankroll: c ? units(bankrolls.get(c.address) ?? 0n) : "0",
        atRisk: c ? units(c.atRisk) : "0",
        stakes: c?.stakes ?? 0,
        won: c?.won ?? 0,
        lost: c?.lost ?? 0,
        recentBets: (c?.recentBets ?? []).map((b) => ({
          claimId: b.marketId,
          stake: units(b.amount),
          href: `/arena/arc/${b.kind}/${b.marketId}`,
          label: `${b.kind === "vs" ? "VS" : "Pool"} #${b.marketId}`,
        })),
      };
    });
  }, [council, bankrolls, solana]);

  if (council === undefined) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const sum = (f: (p: RosterPersona) => string) => personas.reduce((a, p) => a + BigInt(f(p)), 0n);

  return (
    <>
      <Strip label={t("stripLabel")} className="overflow-hidden rounded-2xl">
        <StripCell label={t("statPersonas")} value={personas.length} />
        <StripCell label={t("statStakes")} value={personas.reduce((a, p) => a + p.stakes, 0)} />
        <StripCell label={t("statAtRisk")} value={formatUsdcUnitsBare(sum((p) => p.atRisk))} />
        <StripCell label={t("statBankroll")} value={formatUsdcUnitsBare(sum((p) => p.bankroll))} />
      </Strip>

      <article className={`${SURFACE} grid gap-4 p-5 shadow-[inset_0_0_0_1px_rgb(255_81_72/.28)] sm:flex sm:items-center sm:gap-6 sm:p-6`}>
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <PeepAvatar seed="oracle-mimir" size={48} shape="square" tone="accent" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-display text-[1.5rem] leading-none text-cream">{t("oracle.name")}</h2>
              <StatusPill tone="live" className="!min-h-[24px] !text-[12px]">
                {t("oracle.role")}
              </StatusPill>
            </div>
            <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-muted">{t("oracle.blurb")}</p>
          </div>
        </div>
        <div className="flex flex-none items-baseline gap-5 text-[13px]">
          <div>
            <p className="m-0 text-muted">Verdicts</p>
            <p className="m-0 font-mono text-[16px] tabular-nums text-cream">{oracle?.verdicts ?? "-"}</p>
          </div>
          {oracle?.address ? (
            <a href={arcExplorerUrl("address", oracle.address)} target="_blank" rel="noreferrer" className="ml-auto self-center font-mono text-[12px] text-muted hover:text-coral sm:ml-0">
              {short(oracle.address)} ↗
            </a>
          ) : null}
        </div>
      </article>

      <CouncilRoster personas={personas} />

      <p className="m-0 text-center text-[12px] text-dim">Live from the Arc index; each persona bets from its own Circle wallet on Arc.</p>
    </>
  );
}

/** Native USDC (wei) of each address, read once per set of addresses. */
function useBankrolls(addresses: Address[] | undefined) {
  const [map, setMap] = useState<Map<string, bigint>>(new Map());
  const key = addresses?.join(",") ?? "";
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const client = arcPublicClient();
    void Promise.all(key.split(",").map(async (a) => [a, await client.getBalance({ address: a as Address }).catch(() => 0n)] as const)).then(
      (rows) => !cancelled && setMap(new Map(rows)),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}
