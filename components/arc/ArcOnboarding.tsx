"use client";

/**
 * First steps on Arc, shown on the Arena until done or dismissed: connect a
 * Solana wallet, create the passkey account, link the two, add USDC over CCTP,
 * place a first stake. Every step reads real state; nothing is ticked by hand.
 * Funding counts as done once anyone has staked (a spent balance is not a step
 * undone), and once all five are done the card is gone for good.
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import { useArcAccount } from "./arena/useArcAccount";

const KEY = "mimir:arc-onboarding-hidden";

export default function ArcOnboarding() {
  const account = useArcAccount();
  const { wallet } = account;
  const positions = useQuery(api.arc.positionsOf, account.address ? { user: account.address } : "skip");
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const steps: Array<{ title: string; done: boolean; href: string }> = [
    { title: "Connect your Solana wallet", done: Boolean(wallet.solana), href: "/wallet" },
    { title: "Create your Arc account with a passkey", done: Boolean(wallet.session), href: "/wallet" },
    { title: "Link it to your Solana wallet", done: wallet.linked, href: "/wallet" },
    { title: "Add USDC from Solana", done: (account.balance ?? 0n) > 0n || (positions?.length ?? 0) > 0, href: "/wallet" },
    { title: "Place your first stake", done: (positions?.length ?? 0) > 0, href: "/arena" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const finished = doneCount === steps.length;
  useEffect(() => {
    if (!finished) return;
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  }, [finished]);
  if (hidden || wallet.restoring || doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done);

  return (
    <section aria-label="Get started" className={`${SURFACE} grid gap-4 p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] text-cream">
          Get started on Arc <span className="text-dim">· {doneCount}/{steps.length}</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(KEY, "1");
            } catch {}
          }}
          className="text-[12px] text-muted hover:text-cream"
        >
          Hide
        </button>
      </div>
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.title} className={`rounded-xl p-3 text-[13px] ${s.done ? "bg-panel text-muted" : s === next ? "bg-panel-raised text-cream shadow-[inset_0_0_0_1px_rgb(255_81_72/.5)]" : "bg-panel text-dim"}`}>
            <span className={`mr-1.5 font-mono ${s.done ? "text-win" : "text-coral"}`}>{s.done ? "✓" : i + 1}</span>
            {s === next ? (
              <Link href={s.href} className="hover:underline">
                {s.title}
              </Link>
            ) : (
              s.title
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
