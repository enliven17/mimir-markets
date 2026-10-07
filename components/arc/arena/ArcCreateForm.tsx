"use client";

/**
 * /arena/create on Arc: open a VS market (the default: you back one side,
 * challengers take the other, up to 5× your stake) or a two-sided pool, in
 * one form. One passkey prompt creates and funds it; then the market page.
 */
import { useMemo, useState } from "react";
import { parseEventLogs } from "viem";

import { SURFACE } from "@/components/arena/surface";
import { Link, useRouter } from "@/i18n/navigation";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { createMarketCall, LOCK_SECONDS, MAX_POOL_MULTIPLE, MIMIR_POOL_ABI, MIMIR_V3_ABI, MIN_STAKE_WEI, parseUsdc, type ArcMarketKind } from "@/lib/arc/markets";
import { CATEGORIES } from "@/lib/constants";
import { mentionsPastDay } from "@/lib/past-date";
import AccountGate from "./AccountGate";
import { BTN_PRIMARY, KIND_LABEL, usd } from "./shared";
import { useArcAccount } from "./useArcAccount";
import { useArcSend } from "./useArcSend";

const FIELD = "rounded-xl bg-ink-deep px-4 py-3 text-[15px] text-cream outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(255_81_72/.7)]";
// Leave the deadline at least this far out, so the tx and the betting lock both fit.
const MIN_LEAD_SECONDS = 10 * 60;

/** datetime-local value (local time) for a unix second. */
const localInput = (sec: number) => {
  const d = new Date(sec * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function isHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default function ArcCreateForm() {
  const router = useRouter();
  const account = useArcAccount();
  const { send, busy, error } = useArcSend(account.session);
  const [kind, setKind] = useState<ArcMarketKind>("vs");
  const [question, setQuestion] = useState("");
  const [labelA, setLabelA] = useState("Yes");
  const [labelB, setLabelB] = useState("No");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("crypto");
  const [deadline, setDeadline] = useState(() => localInput(Math.floor(Date.now() / 1000) + 86_400));
  const [amount, setAmount] = useState("5");
  const [side, setSide] = useState<1 | 2>(1);
  const [stage, setStage] = useState<string | null>(null);

  const stake = parseUsdc(amount);
  const deadlineSec = Math.floor(new Date(deadline).getTime() / 1000);
  const contract = kind === "vs" ? ARC.contracts.mimirV3 : ARC.contracts.mimirPool;

  const problem = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    if (question.trim().length < 10) return "Write the question (at least 10 characters).";
    // A day that has already passed means the outcome is public: refuse it (lib/past-date.ts).
    if (mentionsPastDay(question, Date.now(), { includeToday: false })) return "The question names a day that has passed: its outcome is already known.";
    if (!labelA.trim() || !labelB.trim() || labelA.trim() === labelB.trim()) return "Name both sides, differently.";
    if (!isHttpUrl(url.trim())) return "Add a resolution source (an http(s) link the oracle checks).";
    if (!Number.isFinite(deadlineSec) || deadlineSec < now + MIN_LEAD_SECONDS) return "Set the deadline at least 10 minutes from now.";
    if (stake === null || stake < MIN_STAKE_WEI) return "Stake at least $2.";
    if (account.balance !== null && stake > account.balance) return "not-enough";
    return null;
  }, [question, labelA, labelB, url, deadlineSec, stake, account.balance]);

  const onCreate = async () => {
    if (problem || !contract || stake === null) return;
    setStage("Confirm with your passkey…");
    const r = await send([
      createMarketCall(contract, {
        kind,
        question: question.trim(),
        labelA: labelA.trim(),
        labelB: labelB.trim(),
        resolutionUrl: url.trim(),
        category,
        deadline: deadlineSec,
        stake,
        side,
      }),
    ]);
    if (!r) return setStage(null);
    setStage("Opening the market page…");
    const receipt = await arcPublicClient().getTransactionReceipt({ hash: r.txHash });
    const logs =
      kind === "vs"
        ? parseEventLogs({ abi: MIMIR_V3_ABI, logs: receipt.logs, eventName: "ClaimCreated" })
        : parseEventLogs({ abi: MIMIR_POOL_ABI, logs: receipt.logs, eventName: "MarketCreated" });
    const id = logs.find((l) => l.address.toLowerCase() === contract.toLowerCase())?.args.id;
    if (id === undefined) return setStage(null);
    router.push(`/arena/arc/${kind}/${id}`);
  };

  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-6">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Arc · {ARC.network}</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Open a market</h1>
      </header>

      <section className={`${SURFACE} grid gap-5 p-5 sm:p-7`}>
        <div role="radiogroup" aria-label="Market type" className="grid grid-cols-2 gap-2">
          {(["vs", "pool"] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`grid gap-1 rounded-xl p-4 text-left ${kind === k ? "bg-panel-raised shadow-[inset_0_0_0_1px_rgb(255_81_72/.6)]" : "bg-panel"}`}
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-coral">{KIND_LABEL[k]}</span>
              <span className="text-[13px] leading-snug text-muted">
                {k === "vs" ? "You back one side, challengers take the other (up to 5× your stake)." : "Two-sided pool: anyone stakes either side."}
              </span>
            </button>
          ))}
        </div>

        <label className="grid gap-1.5 text-[13px] text-muted">
          Question
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={280} className={FIELD} placeholder="Will BTC close above $120k on Oct 31?" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-[13px] text-muted">
            {kind === "vs" ? "Your side" : "Side A"}
            <input value={labelA} onChange={(e) => setLabelA(e.target.value)} maxLength={60} className={FIELD} />
          </label>
          <label className="grid gap-1.5 text-[13px] text-muted">
            {kind === "vs" ? "Challengers' side" : "Side B"}
            <input value={labelB} onChange={(e) => setLabelB(e.target.value)} maxLength={60} className={FIELD} />
          </label>
        </div>

        <label className="grid gap-1.5 text-[13px] text-muted">
          Resolution source
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" className={FIELD} placeholder="https://www.coingecko.com/en/coins/bitcoin" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-[13px] text-muted">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] text-muted">
            Deadline
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={FIELD} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-[13px] text-muted">
            Your stake (USDC)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} font-mono`} />
          </label>
          {kind === "pool" ? (
            <label className="grid gap-1.5 text-[13px] text-muted">
              Your stake backs
              <select value={side} onChange={(e) => setSide(Number(e.target.value) as 1 | 2)} className={FIELD}>
                <option value={1}>{labelA || "Side A"}</option>
                <option value={2}>{labelB || "Side B"}</option>
              </select>
            </label>
          ) : null}
        </div>

        {stake !== null ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-panel p-3.5 text-[13px]">
            <span className="text-muted">You risk</span>
            <span className="text-right text-cream">{usd(stake)}</span>
            {kind === "vs" ? (
              <>
                <span className="text-muted">You win at most</span>
                <span className="text-right text-win">{usd(stake * (MAX_POOL_MULTIPLE + 1n))} before fees</span>
              </>
            ) : (
              <>
                <span className="text-muted">You win</span>
                <span className="text-right text-win">your share of the other side</span>
              </>
            )}
          </div>
        ) : null}

        <p className="m-0 text-[12px] leading-relaxed text-dim">
          Betting closes {LOCK_SECONDS} s before the deadline. The oracle then proposes a result from the source, anyone may dispute it, and payouts go straight to Arc accounts. A
          draw or an unresolvable market refunds everyone.
        </p>

        <AccountGate account={account}>
          {problem === "not-enough" ? (
            <Link href="/wallet" className={`${BTN_PRIMARY} text-center`}>
              Add USDC from Solana
            </Link>
          ) : (
            <>
              {problem ? <p className="m-0 text-[13px] text-pending">{problem}</p> : null}
              <button className={BTN_PRIMARY} disabled={busy || stage !== null || Boolean(problem) || !contract} onClick={() => void onCreate()}>
                {stage ?? `Open with ${stake ? usd(stake) : "-"}`}
              </button>
            </>
          )}
          {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
          <p className="m-0 text-[12px] text-dim">Arc balance: {account.balance === null ? "-" : usd(account.balance)}</p>
        </AccountGate>
      </section>
    </div>
  );
}
