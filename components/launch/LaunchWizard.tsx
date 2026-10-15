"use client";

/**
 * /launch/new: launch a hosted agent (ported from snipad's LaunchWizard, in Mimir's look). Five steps: who it is,
 * its brain, Mimir markets on Arc, Solana trading (optional), then review. Launching is three wallet actions, each
 * safe to retry: sign the agent (the server makes its two wallets), send the seed SOL, sign the launch (it mints
 * its token on pump.fun). An Argus launch (chain "arc") swaps the SOL step for a little USDC in its Arc wallet, and the
 * token goes live on Argus with a buy and sell tax.
 */
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import Chip from "@/components/ui/Chip";
import Slider from "@/components/ui/Slider";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { Link } from "@/i18n/navigation";
import { BODIES, COLOURS, EYES, PALETTE, avatarFromSeed, encodeAvatarSeed, type AvatarPicks } from "@/lib/avatar";
import { BYOK_PROVIDERS, type ByokProvider } from "@/lib/launch/byok-providers";
import { signedPost } from "@/lib/launch/client";
import { LAUNCH_FEE_SOL, PRESETS, SOURCES, STRATEGIES } from "@/lib/launch/presets";
import { METRICS, type Condition, type DataSource, type Metric } from "@/lib/launch/types";
import { CATEGORIES } from "@/lib/constants";
import { AGENT_MARKETS_PER_DAY_MAX } from "@/lib/launch/agent-markets-limit";
import AgentFace from "./AgentFace";
import ByokGuide from "./ByokGuide";
import FeeAllocator, { AllocationBar } from "./FeeAllocator";
import { DEFAULT_ALLOCATION, perSol, sumsTo100, type Allocation } from "@/lib/launch/fees-view";

const STEPS = ["Identity", "Brain", "Markets", "Trading", "Token", "Launch"] as const;
/** What the agent's Arc wallet must hold to launch on Argus (lib/launch/argus.ts ARGUS.launchGasWei). */
const ARGUS_GAS_USDC = 0.15;
type Preset = keyof typeof PRESETS;

const INITIAL = {
  name: "", ticker: "", description: "", image: null as string | null, avatar: {} as AvatarPicks,
  thesis: "",
  brain: "mimir" as "mimir" | ByokProvider, apiKey: "", model: "",
  markets: { enabled: true, categories: [] as string[], minEdge: 8, kellyFraction: 25, maxStakeUsdc: 5, budgetUsdc: 20, opens: false, opensPerDay: 1 },
  trading: { enabled: false, preset: "trending" as Preset, sources: [...PRESETS.trending.sources], entry: PRESETS.trending.entry.map((c) => ({ ...c })), whales: "", risk: { slippageBps: 300, positionPct: 5, stopLossPct: 15, takeProfitPct: 40, maxDailyLossPct: 20 }, trailingStopPct: 0, maxHoldMinutes: 0 },
  seedSol: "0.1",
  allocation: DEFAULT_ALLOCATION as Allocation,
  chain: "solana" as "solana" | "arc",
  argus: { buyTaxPct: 2, sellTaxPct: 2 },
};
type Form = typeof INITIAL;

const faceBase = (f: Form) => f.ticker.toLowerCase() || "agent";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function problems(step: number, f: Form): string | null {
  if (step === 0) {
    if (f.name.trim().length < 2) return "Give it a name (2 to 32 characters).";
    if (!/^[A-Z0-9]{2,10}$/.test(f.ticker)) return "The ticker is 2 to 10 letters or digits.";
  }
  if (step === 1 && f.brain !== "mimir" && f.apiKey.trim().length < 16) return "Paste the API key, or use Mimir AI.";
  if (step === 3 && f.trading.enabled) {
    if (!f.trading.sources.length) return "Pick at least one source.";
    if (!f.trading.entry.length) return "Add at least one entry rule.";
    const whales = f.trading.whales.split(/\s+/).filter(Boolean);
    if (f.trading.sources.includes("helius") && (!whales.length || whales.some((w) => !B58.test(w)))) return "Add the Solana wallets to follow, one per line.";
  }
  if (step === 3 && !f.trading.enabled && !f.markets.enabled && !f.markets.opens) return "Turn on markets, trading or both.";
  if (step === 4 && !sumsTo100(f.allocation)) return "The four fee buckets must add up to 100.";
  if (step === 4 && f.chain === "arc") {
    if (f.trading.enabled) return "Solana trading needs a pump.fun launch. Turn trading off, or launch on pump.fun.";
    if (f.allocation.holders > 0) return "Holder airdrops are not on Argus yet: set holders to 0.";
    if (f.argus.buyTaxPct + f.argus.sellTaxPct === 0) return "An Argus token needs a buy or sell tax above 0.";
  }
  if (step === 5 && f.chain === "solana" && !(Number(f.seedSol) >= 0 && Number(f.seedSol) <= 100)) return "Seed between 0 and 100 SOL.";
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[14px] text-cream">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

function Range({ label, value, min, max, step = 1, unit, onChange, hint }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="grid gap-2">
      <span className="flex items-baseline justify-between text-[14px] text-cream">
        {label}
        <span className="font-mono tabular-nums text-muted">
          {value}
          {unit}
        </span>
      </span>
      <Slider value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

const DEPLOY = ["Sign the agent: Mimir makes its Solana and Arc wallets", "Send the seed SOL to its wallet", "Sign the launch: its token goes live on pump.fun"] as const;
const DEPLOY_ARGUS = ["Sign the agent: Mimir makes its Solana and Arc wallets", `Send ${ARGUS_GAS_USDC} USDC on Arc to its Arc wallet for the launch gas`, "Sign the launch: its token goes live on Argus"] as const;
type Deploy = { at: number; error: string | null; id?: string; wallet?: string; arc?: string; fund?: bigint; sig?: string; mint?: string };

export default function LaunchWizard() {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<Deploy | null>(null);
  const { publicKey, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { open } = useWalletSheet();
  const seed = encodeAvatarSeed(faceBase(f), f.avatar);
  const spec = avatarFromSeed(seed);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const setM = (p: Partial<Form["markets"]>) => setF((x) => ({ ...x, markets: { ...x.markets, ...p } }));
  const setT = (p: Partial<Form["trading"]>) => setF((x) => ({ ...x, trading: { ...x.trading, ...p } }));
  const setRisk = (p: Partial<Form["trading"]["risk"]>) => setT({ risk: { ...f.trading.risk, ...p } });

  const go = (to: number) => {
    const p = to > step ? problems(step, f) : null;
    setError(p);
    if (!p) setStep(to);
  };

  const onImage = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 500_000) return setError("PNG, JPG, WebP or GIF, 500 KB max.");
    const r = new FileReader();
    r.onload = () => set("image", String(r.result));
    r.readAsDataURL(file);
  };

  const body = () => ({
    name: f.name.trim(), ticker: f.ticker, description: f.description, thesis: f.thesis, avatarSeed: seed, seedSol: f.chain === "arc" ? 0 : Number(f.seedSol), allocation: f.allocation,
    chain: f.chain, ...(f.chain === "arc" ? { argus: { buyTaxBps: Math.round(f.argus.buyTaxPct * 100), sellTaxBps: Math.round(f.argus.sellTaxPct * 100) } } : {}),
    ...(f.image ? { image: f.image } : {}),
    brain: f.brain === "mimir" ? { kind: "mimir" } : { kind: "byok", provider: f.brain, apiKey: f.apiKey.trim(), ...(f.model.trim() ? { model: f.model.trim() } : {}) },
    markets: { enabled: f.markets.enabled, categories: f.markets.categories, minEdge: f.markets.minEdge / 100, kellyFraction: f.markets.kellyFraction / 100, maxStakeUsdc: f.markets.maxStakeUsdc, budgetUsdc: f.markets.budgetUsdc, create: { enabled: f.markets.opens, perDay: f.markets.opensPerDay } },
    trading: f.trading.enabled
      ? { enabled: true, strategy: { preset: f.trading.preset, sources: f.trading.sources, entry: f.trading.entry, whales: f.trading.whales.split(/\s+/).filter(Boolean) }, risk: f.trading.risk, trailingStopPct: f.trading.trailingStopPct, maxHoldMinutes: f.trading.maxHoldMinutes }
      : { enabled: false },
  });

  /** Runs the launch from wherever it stopped; every step is safe to repeat. */
  const run = async (from: Deploy = { at: 0, error: null }) => {
    let d: Deploy = { ...from, error: null };
    const put = (p: Partial<Deploy>) => setDeploy((d = { ...d, ...p }));
    put({});
    try {
      if (!publicKey || !signMessage) throw new Error("Connect a wallet that can sign messages.");
      const owner = publicKey.toBase58();
      if (!d.id) {
        put({ at: 0 });
        const r = await signedPost<{ id: string; solana: string; arc: string; fundLamports: string }>("/api/launch", { owner, signMessage, action: "create", agent: "new", body: body() });
        put({ id: r.id, wallet: r.solana, arc: r.arc, fund: BigInt(r.fundLamports) });
      }
      if (f.chain === "arc") {
        // The owner tops up its Arc wallet from their Arc account; the launch call says so until the USDC is there.
        put({ at: 1 });
        try {
          const r = await signedPost<{ token: string }>(`/api/launch/${d.id}/launch`, { owner, signMessage, action: "launch", agent: d.id!, body: {} });
          put({ mint: r.token, at: DEPLOY_ARGUS.length });
        } catch (e) {
          const msg = String((e as Error).message);
          if (/USDC to the agent's Arc wallet/.test(msg)) throw new Error(`Send ${ARGUS_GAS_USDC} USDC on Arc to ${d.arc}, then retry.`);
          put({ at: 2 });
          throw e;
        }
        return;
      }
      if (!d.sig) {
        put({ at: 1 });
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(d.wallet!), lamports: d.fund! }));
        const sig = await sendTransaction(tx, connection);
        put({ sig });
        await connection.confirmTransaction(sig, "confirmed");
      }
      if (!d.mint) {
        put({ at: 2 });
        // The server's RPC can trail ours by a slot or two: retry "not found yet" a few times.
        for (let i = 0; ; i++) {
          try {
            const r = await signedPost<{ mint: string }>(`/api/launch/${d.id}/launch`, { owner, signMessage, action: "launch", agent: d.id!, body: { sig: d.sig } });
            put({ mint: r.mint });
            break;
          } catch (e) {
            if (i >= 4 || !/not found yet|try again in a few/i.test(String((e as Error).message))) throw e;
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }
      put({ at: DEPLOY.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Launch failed.";
      put({ error: /reject|denied|cancel/i.test(msg) ? "You declined it in your wallet." : msg });
    }
  };

  if (deploy) {
    const steps = f.chain === "arc" ? DEPLOY_ARGUS : DEPLOY;
    const done = deploy.at >= steps.length;
    return (
      <div className="mx-auto grid w-full max-w-[640px] gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-6 shadow-card">
        <div className="flex items-center gap-4">
          <AgentFace seed={seed} size={64} mood={done ? "won" : deploy.error ? "lost" : "thinking"} />
          <div>
            <p className="m-0 font-display text-[1.6rem] leading-none text-cream">{f.name}</p>
            <p className="m-0 mt-1 font-mono text-[13px] text-coral">${f.ticker}</p>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-2 p-0 text-[14px]" aria-live="polite">
          {steps.map((l, i) => (
            <li key={l} className={`flex justify-between gap-4 ${i > deploy.at ? "text-dim" : "text-cream"}`}>
              <span>{l}</span>
              <span className={i < deploy.at ? "text-emerald-300" : deploy.error && i === deploy.at ? "text-coral" : "text-muted"}>
                {i < deploy.at ? "done" : i === deploy.at ? (deploy.error ? "stopped" : "…") : ""}
              </span>
            </li>
          ))}
        </ol>
        {deploy.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-cream/10 pt-4">
            <span className="text-[14px] text-coral">{deploy.error}</span>
            <button type="button" className="btn-primary ml-auto !w-auto !px-5" onClick={() => void run(deploy)}>
              Retry from here
            </button>
          </div>
        ) : null}
        {done ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-cream/10 pt-4">
            <span className="text-[14px] text-cream">{f.name} is live. Fund its Arc wallet with USDC to let it stake.</span>
            <Link href={`/launch/${deploy.id}`} className="btn-primary ml-auto !w-auto !px-5">
              Open its page
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  const t = f.trading;
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start">
        <ol className="m-0 flex list-none gap-1 p-0 lg:flex-col" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1 lg:flex-none">
              <button
                type="button"
                disabled={i > step}
                onClick={() => go(i)}
                aria-current={i === step ? "step" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${i === step ? "bg-cream text-ink" : i < step ? "bg-cream/[0.06] text-cream hover:bg-cream/10" : "text-dim"}`}
              >
                <span className="font-mono text-[12px]">0{i + 1}</span>
                <span className="max-sm:sr-only">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="hidden items-center gap-3 rounded-2xl bg-cream/[0.04] p-4 lg:flex">
          <AgentFace seed={seed} size={56} mood={step === 1 ? "thinking" : step === 5 ? "aiming" : "neutral"} />
          <div className="min-w-0">
            <p className="m-0 truncate font-display text-[1.2rem] leading-none text-cream">{f.name || "Your agent"}</p>
            <p className="m-0 mt-1 font-mono text-[12px] text-coral">${f.ticker || "TICKER"}</p>
          </div>
        </div>
      </aside>

      <div className="grid gap-6 rounded-2xl bg-[rgb(27_19_20/.93)] p-6 shadow-card max-sm:p-4">
        {step === 0 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-2 font-display text-[1.6rem] text-cream">Who is it?</legend>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Name">
                <input className="input" value={f.name} maxLength={32} onChange={(e) => set("name", e.target.value)} placeholder="Njord" />
              </Field>
              <Field label="Ticker">
                <input className="input font-mono" value={f.ticker} maxLength={10} onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="NJORD" />
              </Field>
            </div>
            <Field label="Token description" hint="Shown on pump.fun.">
              <textarea className="input min-h-[5rem]" rows={3} maxLength={280} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="grid justify-items-center gap-2">
                {f.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the upload
                  <img src={f.image} alt="" width={112} height={112} className="h-28 w-28 rounded-xl object-cover" />
                ) : (
                  <AgentFace seed={seed} size={112} />
                )}
                <button type="button" className="text-[13px] text-coral hover:underline" onClick={() => set("avatar", { ...f.avatar, reroll: (f.avatar.reroll ?? 0) + 1 })}>
                  Reroll face
                </button>
              </div>
              <div className="grid content-start gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Body">
                  {BODIES.map((b) => (
                    <Chip key={b} active={spec.body === b} onClick={() => set("avatar", { ...f.avatar, body: b })}>{b}</Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Eyes">
                  {EYES.map((x) => (
                    <Chip key={x} active={spec.eyes === x} onClick={() => set("avatar", { ...f.avatar, eyes: x })}>{x}</Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colour">
                  {COLOURS.map((c) => (
                    <button key={c} type="button" aria-label={c} aria-pressed={spec.colour === c} onClick={() => set("avatar", { ...f.avatar, colour: c })} className={`grid h-8 w-8 place-items-center rounded-full ${spec.colour === c ? "ring-2 ring-cream" : ""}`}>
                      <span className="block h-5 w-5 rounded-full" style={{ background: PALETTE[c].body }} />
                    </button>
                  ))}
                </div>
                <label className="mt-1 text-[13px] text-muted">
                  The face is its token image. Or upload one:{" "}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-[12px]" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {f.image ? (
                  <button type="button" className="justify-self-start text-[13px] text-coral hover:underline" onClick={() => set("image", null)}>
                    Use the face instead
                  </button>
                ) : null}
              </div>
            </div>
          </fieldset>
        ) : null}

        {step === 1 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-2 font-display text-[1.6rem] text-cream">Its brain</legend>
            <Field label="Thesis" hint="Plain words. It steers how the AI judges markets and ranks tokens; the rules you set still bind it.">
              <textarea className="input min-h-[6rem]" rows={4} maxLength={600} value={f.thesis} onChange={(e) => set("thesis", e.target.value)} placeholder="Back strong favourites in football, avoid coin flips. On Solana, only tokens with real liquidity." />
            </Field>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
              <Chip active={f.brain === "mimir"} onClick={() => set("brain", "mimir")}>Mimir AI (included)</Chip>
              {(Object.keys(BYOK_PROVIDERS) as ByokProvider[]).map((p) => (
                <Chip key={p} active={f.brain === p} onClick={() => set("brain", p)}>{BYOK_PROVIDERS[p].label}</Chip>
              ))}
            </div>
            {f.brain !== "mimir" ? <ByokGuide provider={f.brain} /> : null}
            {f.brain !== "mimir" ? (
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label={`${BYOK_PROVIDERS[f.brain].label} API key`} hint="Checked with one tiny call, then encrypted. You only ever see its last four characters again.">
                  <input className="input font-mono" type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} />
                </Field>
                <Field label="Model" hint={`Default: ${BYOK_PROVIDERS[f.brain].model}`}>
                  <input className="input font-mono" value={f.model} onChange={(e) => set("model", e.target.value)} placeholder={BYOK_PROVIDERS[f.brain].model} />
                </Field>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {step === 2 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-2 font-display text-[1.6rem] text-cream">Mimir markets on Arc</legend>
            <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
              <span className="text-[14px] text-cream">Stake on Mimir markets from its Arc wallet</span>
              <input type="checkbox" role="switch" className="switch" checked={f.markets.enabled} onChange={(e) => setM({ enabled: e.target.checked })} />
            </label>
            {f.markets.enabled ? (
              <>
                <div className="grid gap-2">
                  <span className="text-[14px] text-cream">Categories</span>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((c) => {
                      const on = f.markets.categories.includes(c.id);
                      return (
                        <Chip key={c.id} active={on} color={c.color} onClick={() => setM({ categories: on ? f.markets.categories.filter((x) => x !== c.id) : [...f.markets.categories, c.id] })}>
                          {c.label}
                        </Chip>
                      );
                    })}
                  </div>
                  <span className="text-[12px] text-muted">{f.markets.categories.length ? "Only these." : "None picked: every category."}</span>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Range label="Smallest edge" value={f.markets.minEdge} min={3} max={30} unit=" pts" onChange={(v) => setM({ minEdge: v })} hint="Its odds must beat the pool's by this much." />
                  <Range label="Kelly fraction" value={f.markets.kellyFraction} min={5} max={100} step={5} unit="%" onChange={(v) => setM({ kellyFraction: v })} hint="Of the log-optimal stake. Lower is calmer." />
                  <Range label="Most per market" value={f.markets.maxStakeUsdc} min={0.5} max={50} step={0.5} unit=" USDC" onChange={(v) => setM({ maxStakeUsdc: v })} />
                  <Range label="Most staked at once" value={f.markets.budgetUsdc} min={1} max={500} unit=" USDC" onChange={(v) => setM({ budgetUsdc: v })} />
                </div>
              </>
            ) : null}
            {/* ponytail: agent-opened markets are switched off on the backend (LAUNCH_AGENT_MARKETS) until they open to everyone. */}
            <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3 opacity-60">
              <span className="grid gap-0.5">
                <span className="text-[14px] text-cream">Let it open markets (gas paid from its Arc wallet) · coming soon</span>
                <span className="text-[12px] text-muted">From its thesis and categories, held to the house creator&apos;s rules: a named source, a deadline 2 hours to 14 days out, sports closing before kickoff. Each one takes a 0.1 USDC seed stake.</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={false} disabled onChange={() => undefined} />
            </label>
            {false && f.markets.opens ? (
              <Range label="Markets a day, at most" value={f.markets.opensPerDay} min={1} max={AGENT_MARKETS_PER_DAY_MAX} unit="" onChange={(v) => setM({ opensPerDay: v })} hint="The same limit a person has." />
            ) : null}
          </fieldset>
        ) : null}

        {step === 3 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-2 font-display text-[1.6rem] text-cream">Solana trading</legend>
            <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
              <span className="text-[14px] text-cream">Trade tokens on Solana under your strategy (optional)</span>
              <input type="checkbox" role="switch" className="switch" checked={t.enabled} onChange={(e) => setT({ enabled: e.target.checked })} />
            </label>
            {t.enabled ? (
              <>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Preset">
                  {(Object.keys(PRESETS) as Preset[]).map((k) => (
                    <button key={k} type="button" aria-pressed={t.preset === k} onClick={() => setT({ preset: k, sources: [...PRESETS[k].sources], entry: PRESETS[k].entry.map((c) => ({ ...c })) })} className={`grid gap-1 rounded-xl p-3 text-left ${t.preset === k ? "bg-cream text-ink" : "bg-cream/[0.04] text-cream hover:bg-cream/10"}`}>
                      <span className="text-[14px]">{STRATEGIES[k]?.label}</span>
                      <span className={`text-[12px] ${t.preset === k ? "text-ink/70" : "text-muted"}`}>{STRATEGIES[k]?.blurb}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sources">
                  {(Object.keys(SOURCES) as DataSource[]).map((s) => {
                    const on = t.sources.includes(s);
                    return <Chip key={s} active={on} onClick={() => setT({ sources: on ? t.sources.filter((x) => x !== s) : [...t.sources, s] })}>{SOURCES[s]}</Chip>;
                  })}
                </div>
                {t.sources.includes("helius") ? (
                  <Field label="Wallets to follow" hint="Up to 20, one per line. It enters when they buy.">
                    <textarea className="input min-h-[5rem] font-mono text-[13px]" value={t.whales} onChange={(e) => setT({ whales: e.target.value })} />
                  </Field>
                ) : null}
                <div className="grid gap-2">
                  <span className="text-[14px] text-cream">Enter only when</span>
                  {t.entry.map((c, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_120px_auto] items-center gap-2">
                      <select className="input" value={c.metric} onChange={(e) => setT({ entry: t.entry.map((x, j) => (j === i ? { ...x, metric: e.target.value as Metric } : x)) })}>
                        {(Object.keys(METRICS) as Metric[]).map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
                      </select>
                      <button type="button" className="input !w-12 font-mono" onClick={() => setT({ entry: t.entry.map((x, j) => (j === i ? { ...x, op: x.op === ">" ? "<" : ">" } : x)) })}>{c.op}</button>
                      <input className="input font-mono" inputMode="decimal" value={String(c.value)} onChange={(e) => setT({ entry: t.entry.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)) })} />
                      <button type="button" aria-label="Remove rule" className="text-muted hover:text-coral" onClick={() => setT({ entry: t.entry.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  ))}
                  {t.entry.length < 8 ? (
                    <button type="button" className="justify-self-start text-[13px] text-coral hover:underline" onClick={() => setT({ entry: [...t.entry, { metric: "liquidityUsd", op: ">", value: 0 } as Condition] })}>
                      + Add rule
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Range label="Size per trade" value={t.risk.positionPct} min={1} max={25} unit="%" onChange={(v) => setRisk({ positionPct: v })} />
                  <Range label="Max slippage" value={t.risk.slippageBps / 100} min={0.5} max={10} step={0.5} unit="%" onChange={(v) => setRisk({ slippageBps: Math.round(v * 100) })} />
                  <Range label="Stop loss" value={t.risk.stopLossPct} min={5} max={50} unit="%" onChange={(v) => setRisk({ stopLossPct: v })} />
                  <Range label="Take profit" value={t.risk.takeProfitPct} min={10} max={300} step={5} unit="%" onChange={(v) => setRisk({ takeProfitPct: v })} />
                  <Range label="Daily loss cap" value={t.risk.maxDailyLossPct} min={5} max={50} unit="%" onChange={(v) => setRisk({ maxDailyLossPct: v })} hint="It pauses itself when hit." />
                  <Range label="Trailing stop" value={t.trailingStopPct} min={0} max={30} unit="%" onChange={(v) => setT({ trailingStopPct: v })} hint={t.trailingStopPct ? undefined : "Off."} />
                  <Range label="Max hold" value={t.maxHoldMinutes} min={0} max={240} step={5} unit=" min" onChange={(v) => setT({ maxHoldMinutes: v })} hint={t.maxHoldMinutes ? undefined : "Off."} />
                </div>
              </>
            ) : null}
          </fieldset>
        ) : null}

        {step === 4 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-2 font-display text-[1.6rem] text-cream">Its token and where the fees go</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Launchpad">
              {([
                ["solana", "pump.fun on Solana", "A bonding-curve token. Creator fees on every trade go to the agent. Needs seed SOL."],
                ["arc", "Argus on Arc", "A USDC-paired token with a buy and sell tax. Paid in USDC on Arc, no SOL needed. No Solana trading."],
              ] as const).map(([k, label, blurb]) => (
                <button key={k} type="button" role="radio" aria-checked={f.chain === k} onClick={() => set("chain", k)} className={`grid gap-1 rounded-xl p-3 text-left ${f.chain === k ? "bg-cream text-ink" : "bg-cream/[0.04] text-cream hover:bg-cream/10"}`}>
                  <span className="text-[14px]">{label}</span>
                  <span className={`text-[12px] ${f.chain === k ? "text-ink/70" : "text-muted"}`}>{blurb}</span>
                </button>
              ))}
            </div>
            {f.chain === "arc" ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Range label="Buy tax" value={f.argus.buyTaxPct} min={0} max={10} step={0.5} unit="%" onChange={(v) => set("argus", { ...f.argus, buyTaxPct: v })} />
                  <Range label="Sell tax" value={f.argus.sellTaxPct} min={0} max={10} step={0.5} unit="%" onChange={(v) => set("argus", { ...f.argus, sellTaxPct: v })} />
                </div>
                <p className="m-0 text-[14px] text-muted">
                  Every buy and sell of <span className="font-mono text-cream">${f.ticker || "TICKER"}</span> pays its tax plus the pool&apos;s 1% fee in USDC. Argus keeps 10%, the platform 10% and AI costs 10%; you split the other 70%. Your buyback share burns on chain; bankroll and payout land in its Arc wallet. Holder airdrops are not on Argus yet, so keep holders at 0.
                </p>
              </>
            ) : (
              <p className="m-0 text-[14px] text-muted">
                Every trade of <span className="font-mono text-cream">${f.ticker || "TICKER"}</span> on pump.fun pays creator fees to the agent. 10% goes to the platform and 10% to AI costs; you split the other 80%. Put enough in gas &amp; bankroll and a traded agent pays its own way.
              </p>
            )}
            <FeeAllocator value={f.allocation} onChange={(a) => set("allocation", a)} />
            <p className="m-0 text-[13px] text-muted">Public on its page. You can change it later: a change shows at once and applies 24 hours later.</p>
          </fieldset>
        ) : null}

        {step === 5 ? (
          <div className="grid gap-5">
            <h2 className="m-0 font-display text-[1.6rem] text-cream">Check and launch</h2>
            <dl className="kv">
              <dt>Agent</dt>
              <dd>{f.name} · ${f.ticker}</dd>
              <dt>Brain</dt>
              <dd>{f.brain === "mimir" ? "Mimir AI" : `${BYOK_PROVIDERS[f.brain].label} (your key)`}</dd>
              <dt>Markets</dt>
              <dd>
                {f.markets.enabled ? `edge ≥ ${f.markets.minEdge} pts · up to ${f.markets.maxStakeUsdc} USDC each · ${f.markets.budgetUsdc} USDC at once` : "off"}
                {f.markets.opens ? ` · opens up to ${f.markets.opensPerDay} a day` : ""}
              </dd>
              <dt>Trading</dt>
              <dd>{t.enabled ? `${STRATEGIES[t.preset]?.label} · SL ${t.risk.stopLossPct}% · TP ${t.risk.takeProfitPct}% · cap ${t.risk.maxDailyLossPct}%` : "off"}</dd>
              <dt>Token</dt>
              <dd>{f.chain === "arc" ? `Argus on Arc · ${f.argus.buyTaxPct}% buy / ${f.argus.sellTaxPct}% sell tax` : "pump.fun on Solana"}</dd>
              <dt>Fees</dt>
              <dd>
                <AllocationBar allocation={f.allocation} className="mt-1 h-2.5 max-w-[280px]" />
                {f.chain === "solana" ? <span className="mt-1 block text-[12px] text-muted">{perSol(f.allocation, { creator: "to you" })} per 1 SOL</span> : null}
              </dd>
            </dl>
            {f.chain === "arc" ? (
              <p className="m-0 text-[14px] text-cream">After you sign, send {ARGUS_GAS_USDC} USDC on Arc to its Arc wallet: it pays the launch gas. No SOL needed.</p>
            ) : (<>
            <Field label="Seed SOL" hint={`Goes to its Solana wallet: ${LAUNCH_FEE_SOL} SOL mints its token, the rest is gas and bankroll. Its Arc wallet needs USDC to stake; fund it from its page after launch.`}>
              <input className="input font-mono" inputMode="decimal" value={f.seedSol} onChange={(e) => set("seedSol", e.target.value)} />
            </Field>
            <p className="m-0 text-[14px] text-cream">You send {(Number(f.seedSol || 0) + LAUNCH_FEE_SOL).toFixed(3)} SOL.</p>
            </>)}
            <p className="m-0 text-[13px] text-muted">It stakes and trades real funds on mainnet and can lose them. You can pause it, withdraw part of its funds or shut it down any time from its page.</p>
          </div>
        ) : null}

        {error ? <p role="alert" className="m-0 text-[14px] text-coral">{error}</p> : null}

        <div className="flex items-center justify-between border-t border-cream/10 pt-4">
          {step > 0 ? (
            <button type="button" className="text-[14px] text-muted hover:text-cream" onClick={() => go(step - 1)}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary !w-auto !px-6" onClick={() => go(step + 1)}>
              Continue
            </button>
          ) : publicKey ? (
            <button type="button" className="btn-primary !w-auto !px-6" onClick={() => { const p = problems(5, f); setError(p); if (!p) void run(); }}>
              Sign and launch
            </button>
          ) : (
            <button type="button" className="btn-primary !w-auto !px-6" onClick={open}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
