"use client";

/**
 * In-app notifications for the connected wallet: challenges on your claims,
 * proposed / disputed / final verdicts and payouts you can pull. The feed is
 * derived by the indexer from on-chain changes (lib/notifications.ts); "seen"
 * is a per-browser convenience in localStorage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bell } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { formatUsdcUnits } from "@/lib/money";

interface Item {
  id: number;
  claimId: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

const POLL_MS = 60_000;
const seenKey = (address: string) => `mimir.notifications.seen.${address}`;

function readSeen(address: string): number {
  try {
    return Number(localStorage.getItem(seenKey(address)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export default function NotificationBell() {
  const t = useTranslations("notifications");
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [items, setItems] = useState<Item[]>([]);
  const [seen, setSeen] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/notifications?address=${encodeURIComponent(address)}`);
      if (res.ok) setItems(((await res.json()) as { items?: Item[] }).items ?? []);
    } catch {
      /* try again next poll */
    }
  }, [address]);

  useEffect(() => {
    if (!connected || !address) {
      setItems([]);
      return;
    }
    setSeen(readSeen(address));
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [address, connected, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!connected || !address) return null;
  const unread = items.filter((i) => i.createdAt > seen).length;

  const describe = (item: Item): string => {
    const q = String(item.payload.question ?? `#${item.claimId}`);
    switch (item.kind) {
      case "challenged":
        return t("challenged", { q });
      case "proposed":
        return item.payload.youWinIfFinal === true
          ? t("proposedFor", { q })
          : item.payload.youWinIfFinal === false
            ? t("proposedAgainst", { q })
            : t("proposedRefund", { q });
      case "disputed":
        return t("disputed", { q });
      case "resolved":
        return item.payload.youWon === true
          ? t("won", { q })
          : item.payload.youWon === false
            ? t("lost", { q })
            : t("refunded", { q });
      case "payout_claimable":
        return t("claimable", { q, amount: formatUsdcUnits(String(item.payload.grossUnits ?? "0")) });
      case "cancelled":
        return t("cancelled", { q });
      default:
        return q;
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items.length > 0) {
      const newest = Math.max(...items.map((i) => i.createdAt));
      setSeen(newest);
      try {
        localStorage.setItem(seenKey(address), String(newest));
      } catch {
        /* per-browser convenience only */
      }
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? t("ariaUnread", { count: unread }) : t("aria")}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative inline-flex h-9 w-9 items-center justify-center border border-pv-border/25 text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-text focus-ring"
      >
        <Bell size={15} aria-hidden />
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-pv-emerald px-1 text-center font-mono text-[10px] font-bold leading-4 text-pv-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] border border-pv-border/25 bg-pv-bg shadow-xl">
          <p className="border-b border-pv-border/25 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted">
            {t("title")}
          </p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-pv-muted">{t("empty")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="border-b border-pv-border/15 last:border-0">
                  <Link
                    href={`/arena/${item.claimId}`}
                    onClick={() => setOpen(false)}
                    className={`block px-4 py-3 text-sm transition-colors hover:bg-pv-surface focus-ring ${
                      item.createdAt > seen ? "text-pv-text" : "text-pv-text/75"
                    }`}
                  >
                    {describe(item)}
                    <span className="mt-0.5 block font-mono text-[10px] text-pv-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
