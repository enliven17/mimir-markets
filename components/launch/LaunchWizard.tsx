"use client";

/**
 * /launch/new: launch a hosted agent (ported from snipad's LaunchWizard, in Mimir's look). Five steps: who it is,
 * its brain, Mimir markets on Arc, Solana trading (optional), then review. Launching is three wallet actions, each
 * safe to retry: sign the agent (the server makes its two wallets), send the seed SOL, sign the launch (it mints
 * its token on pump.fun). An Argus launch (chain "arc") swaps the SOL step for a little USDC in its Arc wallet, and the
 * token goes live on Argus with a buy and sell tax. A Robinhood launch (chain "robinhood") makes a Robinhood Chain wallet
 * instead of the Solana one, takes its seed in ETH from the connected Robinhood wallet, and launches on Pons. The
 * launchpad is picked first: the trading step depends on it.
 */
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createPublicClient, http } from "viem";

import Chip from "@/components/ui/Chip";
import Disclosure from "@/components/ui/Disclosure";
import Slider from "@/components/ui/Slider";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import RobinhoodConnect from "@/components/robinhood/RobinhoodConnect";
import { useRobinhoodWallet } from "@/components/robinhood/useRobinhoodWallet";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";
import { Link } from "@/i18n/navigation";
import { BODIES, COLOURS, EYES, PALETTE, avatarFromSeed, encodeAvatarSeed, type AvatarPicks } from "@/lib/avatar";
import { BYOK_PROVIDERS, type ByokProvider } from "@/lib/launch/byok-providers";
import { signedPost } from "@/lib/launch/client";
import { demoGet, demoPost } from "@/lib/demo/client";
import { DEMO, type DemoAgent } from "@/lib/demo/types";
import { demoLiveDraft } from "@/lib/demo/promotion";
import DemoUpsell from "@/components/demo/DemoUpsell";
import { LAUNCH_FEE_SOL, PRESETS, RH_LAUNCH_FEE_ETH, RH_PRESETS, RH_SOURCES, RH_STRATEGIES, SOURCES, STRATEGIES } from "@/lib/launch/presets";
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
type Chain = "solana" | "arc" | "robinhood";
type Preset = keyof typeof PRESETS | keyof typeof RH_PRESETS;
const presetsFor = (c: Chain): Partial<Record<Preset, { sources: DataSource[]; entry: Condition[] }>> => (c === "robinhood" ? RH_PRESETS : PRESETS);
const strategiesFor = (c: Chain) => (c === "robinhood" ? RH_STRATEGIES : STRATEGIES);
const sourcesFor = (c: Chain) => (c === "robinhood" ? RH_SOURCES : SOURCES);

const LAUNCHPADS = [
  ["solana", "pump.fun", "Solana", "/launch/pumpfun.png", "Bonding curve · trades tokens · needs seed SOL"],
  ["arc", "Argus", "Arc", "/launch/argus.jpg", "USDC tax token · markets only · no SOL"],
  ["robinhood", "Pons", "Robinhood", "/launch/pons.png", "Bonding curve · trades in ETH · Robinhood wallet"],
] as const;

const INITIAL = {
  name: "", ticker: "", description: "", image: null as string | null, avatar: {} as AvatarPicks,
  thesis: "",
  brain: "mimir" as "mimir" | ByokProvider, apiKey: "", model: "",
  markets: { enabled: true, categories: [] as string[], minEdge: 8, kellyFraction: 25, maxStakeUsdc: 5, budgetUsdc: 20, maxHoursToClose: 72, opens: false, opensPerDay: 1 },
  trading: { enabled: false, preset: "trending" as Preset, sources: [...PRESETS.trending.sources], entry: PRESETS.trending.entry.map((c) => ({ ...c })), whales: "", risk: { slippageBps: 300, positionPct: 5, stopLossPct: 15, takeProfitPct: 40, maxDailyLossPct: 20 }, trailingStopPct: 0, maxHoldMinutes: 0 },
  seedSol: "0.1",
  allocation: DEFAULT_ALLOCATION as Allocation,
  chain: "solana" as Chain,
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
    if (f.chain === "solana" && f.trading.sources.includes("helius") && (!whales.length || whales.some((w) => !B58.test(w)))) return "Add the Solana wallets to follow, one per line.";
  }
  if (step === 3 && !f.trading.enabled && !f.markets.enabled && !f.markets.opens) return "Turn on markets, trading or both.";
  if (step === 4 && !sumsTo100(f.allocation)) return "The four fee buckets must add up to 100.";
  if (step === 4 && f.chain === "arc") {
    if (f.trading.enabled) return "Solana trading needs a pump.fun launch. Turn trading off, or launch on pump.fun.";
    if (f.allocation.holders > 0) return "Holder airdrops are not on Argus yet: set holders to 0.";
    if (f.argus.buyTaxPct + f.argus.sellTaxPct === 0) return "An Argus token needs a buy or sell tax above 0.";
  }
  if (step === 5 && f.chain !== "arc" && !(Number(f.seedSol) >= 0 && Number(f.seedSol) <= 100)) return `Seed between 0 and 100 ${f.chain === "robinhood" ? "ETH" : "SOL"}.`;
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
const DEPLOY_RH = ["Sign the agent: Mimir makes its Robinhood Chain and Arc wallets", "Send the seed ETH from your Robinhood wallet", "Sign the launch: its token goes live on Pons"] as const;
const deploySteps = (c: Chain): readonly string[] => (c === "arc" ? DEPLOY_ARGUS : c === "robinhood" ? DEPLOY_RH : DEPLOY);
type Deploy = { at: number; error: string | null; id?: string; wallet?: string; arc?: string; fund?: bigint; sig?: string; mint?: string };

export default function LaunchWizard({ demo = false }: { demo?: boolean }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<Deploy | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [usedDemos, setUsedDemos] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [fromDemo, setFromDemo] = useState(false);
  const [importedAvatar, setImportedAvatar] = useState<string | null>(null);
  const [existingDemoId, setExistingDemoId] = useState<string | undefined>();
  const { publicKey, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { open } = useWalletSheet();
  const rh = useRobinhoodWallet();
  const seed = importedAvatar ?? encodeAvatarSeed(faceBase(f), f.avatar);
  const spec = avatarFromSeed(seed);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { if (k === "avatar") setImportedAvatar(null); setF((p) => ({ ...p, [k]: v })); };
  const setM = (p: Partial<Form["markets"]>) => setF((x) => ({ ...x, markets: { ...x.markets, ...p } }));
  const setT = (p: Partial<Form["trading"]>) => setF((x) => ({ ...x, trading: { ...x.trading, ...p } }));
  const setRisk = (p: Partial<Form["trading"]["risk"]>) => setT({ risk: { ...f.trading.risk, ...p } });
  /** A launchpad brings its chain's trading presets and sources; an Argus agent does not trade tokens. */
  const setChain = (chain: Chain) => {
    const presets = presetsFor(chain);
    const first = (Object.keys(presets) as Preset[])[0];
    const p = presets[first]!;
    setF((x) => ({ ...x, chain, trading: { ...x.trading, enabled: chain === "arc" ? false : x.trading.enabled, preset: first, sources: [...p.sources], entry: p.entry.map((c) => ({ ...c })) } }));
  };
  const chainPresets = presetsFor(f.chain);
  const flowSteps = demo ? [0, 1, 2, 3, 5] : [0, 1, 2, 3, 4, 5];
  const stepIndex = flowSteps.indexOf(step);
  const validate = (at: number) => demo && at === 5 ? null : problems(at, f);

  useEffect(() => {
    if (demo) {
      let cancelled = false;
      void demoGet(publicKey?.toBase58() ?? "").then((r) => r.json()).then((data) => {
        if (cancelled) return;
        const agents = data.session?.agents as DemoAgent[] | undefined;
        if (agents) { setUsedDemos(agents.length); setExistingDemoId(agents[agents.length - 1]?.id); if (agents.length >= DEMO.maxAgents) setUpsell(true); }
      }).catch(() => undefined);
      return () => { cancelled = true; };
    }
    const id = new URLSearchParams(window.location.search).get("demo");
    if (!id) return;
    let cancelled = false;
    setImportError("");
    if (!publicKey) { setImporting(false); return; }
    setImporting(true);
    void demoGet(publicKey.toBase58()).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not load your preview agent.");
      const agent = (data.session?.agents as DemoAgent[] | undefined)?.find((a) => a.id === id);
      if (!agent) throw new Error("This preview agent is not in your current browser session. Open it from your preview dashboard.");
      if (cancelled) return;
      const draft = demoLiveDraft(agent);
      const t = draft.trading;
      setF((f) => ({ ...f, name: draft.name, ticker: draft.ticker, thesis: draft.thesis, chain: draft.chain,
        markets: { ...f.markets, enabled: draft.markets.enabled, categories: draft.markets.categories, minEdge: draft.markets.minEdge * 100,
          kellyFraction: draft.markets.kellyFraction * 100, maxStakeUsdc: draft.markets.maxStakeUsdc,
          budgetUsdc: draft.markets.budgetUsdc, maxHoursToClose: draft.markets.maxHoursToClose },
        trading: t.enabled ? { ...f.trading, enabled: true, preset: t.strategy.preset as Preset,
          sources: t.strategy.sources, entry: t.strategy.entry, whales: t.strategy.whales.join("\n"),
          risk: t.risk, trailingStopPct: t.trailingStopPct, maxHoldMinutes: t.maxHoldMinutes } : { ...f.trading, enabled: false },
      }));
      setImportedAvatar(draft.avatarSeed); setFromDemo(true); setStep(5);
    }).catch((e) => { if (!cancelled) setImportError(e instanceof Error ? e.message : "Could not load preview."); })
      .finally(() => { if (!cancelled) setImporting(false); });
    return () => { cancelled = true; };
  }, [demo, publicKey]);

  const go = (to: number) => {
    const p = to > step ? validate(step) : null;
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
    chain: f.chain, ...(f.chain === "robinhood" && rh.address ? { payout: rh.address } : {}), ...(f.chain === "arc" ? { argus: { buyTaxBps: Math.round(f.argus.buyTaxPct * 100), sellTaxBps: Math.round(f.argus.sellTaxPct * 100) } } : {}),
    ...(f.image ? { image: f.image } : {}),
    brain: f.brain === "mimir" ? { kind: "mimir" } : { kind: "byok", provider: f.brain, apiKey: f.apiKey.trim(), ...(f.model.trim() ? { model: f.model.trim() } : {}) },
    markets: { enabled: f.markets.enabled, categories: f.markets.categories, minEdge: f.markets.minEdge / 100, kellyFraction: f.markets.kellyFraction / 100, maxStakeUsdc: f.markets.maxStakeUsdc, budgetUsdc: f.markets.budgetUsdc, maxHoursToClose: f.markets.maxHoursToClose, create: { enabled: f.markets.opens, perDay: f.markets.opensPerDay } },
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
      if (demo) {
        if (!publicKey) throw new Error("Connect your wallet first.");
        const r = await demoPost<{ id: string; used: number }>({ action: "agent", input: body() }, publicKey.toBase58());
        put({ id: r.id, at: 2 });
        setUsedDemos(r.used);
        setUpsell(true);
        return;
      }
      if (!publicKey || !signMessage) throw new Error("Connect a wallet that can sign messages.");
      const owner = publicKey.toBase58();
      if (!d.id) {
        put({ at: 0 });
        if (f.chain === "robinhood" && !rh.address) throw new Error("Connect your Robinhood wallet: it funds the agent and gets its ETH back.");
        const r = await signedPost<{ id: string; solana: string | null; robinhood: string | null; arc: string; fundLamports: string }>("/api/launch", { owner, signMessage, action: "create", agent: "new", body: body() });
        put({ id: r.id, wallet: (f.chain === "robinhood" ? r.robinhood : r.solana) ?? undefined, arc: r.arc, fund: BigInt(r.fundLamports) });
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
        if (f.chain === "robinhood") {
          if (!rh.sendEth) throw new Error("Connect your Robinhood wallet to send the seed ETH.");
          const hash = await rh.sendEth(d.wallet!, d.fund!);
          put({ sig: hash });
          await createPublicClient({ transport: http(ROBINHOOD_CHAIN.rpcUrl) }).waitForTransactionReceipt({ hash, timeout: 120_000 });
        } else {
          const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(d.wallet!), lamports: d.fund! }));
          const sig = await sendTransaction(tx, connection);
          put({ sig });
          await connection.confirmTransaction(sig, "confirmed");
        }
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
      put({ at: deploySteps(f.chain).length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Launch failed.";
      put({ error: /reject|denied|cancel/i.test(msg) ? "You declined it in your wallet." : msg });
    }
  };

  if (importing) return <p role="status" className="text-[14px] text-muted">Loading your preview strategy…</p>;
  if (importError) return <div role="alert" className="grid gap-3 text-[14px] text-coral"><p className="m-0">{importError}</p><Link href="/demo">Back to your preview</Link></div>;
  if (deploy) {
    const steps = demo ? ["Use your verified wallet session", "Start your agent with virtual funds"] : deploySteps(f.chain);
    const done = deploy.at >= steps.length;
    return (
      <div className="mx-auto grid w-full max-w-[640px] gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-6 shadow-card">
        {demo ? <DemoUpsell open={upsell} onClose={() => setUpsell(false)} agentId={deploy.id} used={usedDemos} /> : null}
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
            <span className="text-[14px] text-cream">{demo ? `${f.name} is ready with virtual funds. Its first evaluation runs within a few minutes.` : `${f.name} is live. Fund its Arc wallet with USDC to let it stake.`}</span>
            <Link href={demo ? `/demo/${deploy.id}` : `/launch/${deploy.id}`} className="btn-primary ml-auto !w-auto !px-5">
              Open its page
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  if (demo && usedDemos >= DEMO.maxAgents) return <div className="grid gap-4 rounded-2xl bg-cream/5 p-6">
    <DemoUpsell open={upsell} onClose={() => setUpsell(false)} agentId={existingDemoId} used={usedDemos} />
    <h2 className="m-0 font-display text-[1.5rem] text-cream">Your 3 preview agents are ready</h2>
    <p className="m-0 text-[14px] text-muted">Keep following your preview agents or deploy one with real funds and the same rules.</p>
    <Link href="/demo" className="text-coral">Open your preview dashboard →</Link>
    {existingDemoId ? <Link href={`/launch/new?demo=${encodeURIComponent(existingDemoId)}`} className="btn-primary !w-auto justify-self-start !px-5">Deploy as a real agent</Link> : null}
  </div>;

  const t = f.trading;
  return (
    <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6">
      <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-[12px] text-muted lg:hidden">
            <span>
              Step {stepIndex + 1} of {flowSteps.length}
            </span>
            <span className="text-cream">{STEPS[step]}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-cream/10 lg:hidden" aria-hidden>
            <div className="h-full rounded-full bg-coral transition-[width] duration-300" style={{ width: `${((stepIndex + 1) / flowSteps.length) * 100}%` }} />
          </div>
          <ol className="m-0 hidden list-none gap-1 p-0 lg:grid" aria-label="Steps">
            {flowSteps.map((i, index) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${i === step ? "bg-cream text-ink" : i < step ? "bg-cream/[0.06] text-cream hover:bg-cream/10" : "text-dim"}`}
                >
                  <span className="font-mono text-[12px]">0{index + 1}</span>
                  <span>{STEPS[i]}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="hidden items-center gap-3 rounded-2xl bg-cream/[0.04] p-4 lg:flex">
          <AgentFace seed={seed} size={56} mood={step === 1 ? "thinking" : step === 5 ? "aiming" : "neutral"} />
          <div className="min-w-0">
            <p className="m-0 truncate font-display text-[1.2rem] leading-none text-cream">{f.name || "Your agent"}</p>
            <p className="m-0 mt-1 font-mono text-[12px] text-coral">${f.ticker || "TICKER"}</p>
          </div>
        </div>
      </aside>

      <div className="grid gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-5 shadow-card sm:gap-6 sm:p-6">
        {fromDemo ? <p className="m-0 rounded-xl bg-coral/10 p-4 text-[13px] text-cream">Your preview strategy is ready to go live. The same rules are loaded below. Choose real funding and connect your wallet to deploy.</p> : null}
        {step === 0 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Who is it?</legend>
            <div className="grid gap-2">
              <span className="text-[14px] text-cream">{demo ? "Preview network" : "Launchpad"}</span>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Launchpad">
                {LAUNCHPADS.map(([k, label, chainName, logo, blurb]) => (
                  <button key={k} type="button" role="radio" aria-checked={f.chain === k} onClick={() => setChain(k)} className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-xl p-3 text-left transition-colors ${f.chain === k ? "bg-cream text-ink" : "bg-cream/[0.04] text-cream hover:bg-cream/10"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
                    <img src={logo} alt="" width={40} height={40} className="row-span-2 h-10 w-10 rounded-full bg-white object-cover" />
                    <span className="text-[14px] leading-tight">
                      {label} <span className={f.chain === k ? "text-ink/55" : "text-muted"}>· {chainName}</span>
                    </span>
                    <span className={`col-start-2 text-[11px] leading-snug ${f.chain === k ? "text-ink/65" : "text-muted"}`}>{demo ? k === "arc" ? "Virtual USDC · Mimir markets" : `Virtual ${k === "solana" ? "SOL" : "ETH"} · paper trading` : blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Name">
                <input className="input" value={f.name} maxLength={32} onChange={(e) => set("name", e.target.value)} placeholder="Njord" />
              </Field>
              <Field label="Ticker">
                <input className="input font-mono" value={f.ticker} maxLength={10} onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="NJORD" />
              </Field>
            </div>
            {!demo ? <Field label="Token description" hint={`Shown on ${LAUNCHPADS.find(([k]) => k === f.chain)?.[1] ?? "pump.fun"}. Optional.`}>
              <textarea className="input min-h-[4.5rem]" rows={2} maxLength={280} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What it stands for in one or two lines." />
            </Field> : null}
            <div className="flex flex-wrap items-center gap-4 rounded-xl bg-cream/[0.04] p-4">
              {f.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the upload
                <img src={f.image} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-xl object-cover" />
              ) : (
                <AgentFace seed={seed} size={72} />
              )}
              <div className="grid min-w-0 flex-1 gap-2">
                <p className="m-0 text-[14px] text-cream">{demo ? "Agent avatar" : "Token image"}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button type="button" className="text-[13px] text-coral hover:underline" onClick={() => set("avatar", { ...f.avatar, reroll: (f.avatar.reroll ?? 0) + 1 })}>
                    Reroll face
                  </button>
                  {!demo ? <label className="cursor-pointer text-[13px] text-muted hover:text-cream">
                    Upload
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
                  </label> : null}
                  {f.image ? (
                    <button type="button" className="text-[13px] text-muted hover:text-cream" onClick={() => set("image", null)}>
                      Use face
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {!f.image ? (
              <Disclosure summary="Customize face">
                <div className="grid gap-3">
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
                </div>
              </Disclosure>
            ) : null}
          </fieldset>
        ) : null}

        {step === 1 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Its brain</legend>
            <p className="m-0 -mt-2 text-[13px] text-muted">{demo ? "Mimir AI evaluates your thesis within the shared preview allowance. New entries wait when the allowance is used; exit rules keep running." : "Mimir AI is included. Bring your own key only if you want a different model."}</p>
            {!demo ? <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
              <Chip active={f.brain === "mimir"} onClick={() => set("brain", "mimir")}>Mimir AI (included)</Chip>
              {(Object.keys(BYOK_PROVIDERS) as ByokProvider[]).map((p) => (
                <Chip key={p} active={f.brain === p} onClick={() => set("brain", p)}>{BYOK_PROVIDERS[p].label}</Chip>
              ))}
            </div> : null}
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
            <Field label="Thesis" hint="Optional. Steers how it judges markets and ranks tokens; your rules still bind it.">
              <textarea className="input min-h-[5rem]" rows={3} maxLength={600} value={f.thesis} onChange={(e) => set("thesis", e.target.value)} placeholder="Back strong favourites in football, avoid coin flips. On Solana, only tokens with real liquidity." />
            </Field>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Mimir markets</legend>
            <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
              <span className="grid gap-0.5">
                <span className="text-[14px] text-cream">{demo ? "Stake virtual USDC on Mimir markets" : "Stake from its Arc wallet"}</span>
                <span className="text-[12px] text-muted">{demo ? `${DEMO.initialUsdc.toLocaleString()} virtual USDC included. Stakes appear as preview activity on market pages.` : "Fund USDC on its page after launch."}</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={f.markets.enabled} onChange={(e) => setM({ enabled: e.target.checked })} />
            </label>
            {f.markets.enabled ? (
              <>
                <p className="m-0 text-[13px] text-muted">
                  Defaults: edge ≥ {f.markets.minEdge} pts · up to {f.markets.maxStakeUsdc} USDC each · {f.markets.budgetUsdc} USDC at once
                  {f.markets.categories.length ? ` · ${f.markets.categories.length} categories` : " · all categories"}.
                </p>
                <Disclosure summary="Fine-tune markets" defaultOpen={Boolean(error)}>
                  <div className="grid gap-5">
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
                  </div>
                </Disclosure>
              </>
            ) : null}
            {/* Agent-opened markets stay off until LAUNCH_AGENT_MARKETS is live for everyone. */}
            {false ? (
              <>
                <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
                  <span className="text-[14px] text-cream">Let it open markets</span>
                  <input type="checkbox" role="switch" className="switch" checked={f.markets.opens} onChange={(e) => setM({ opens: e.target.checked })} />
                </label>
                {f.markets.opens ? (
                  <Range label="Markets a day, at most" value={f.markets.opensPerDay} min={1} max={AGENT_MARKETS_PER_DAY_MAX} unit="" onChange={(v) => setM({ opensPerDay: v })} hint="The same limit a person has." />
                ) : null}
              </>
            ) : null}
          </fieldset>
        ) : null}

        {step === 3 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Trading</legend>
            {f.chain === "arc" ? (
              <p className="m-0 text-[14px] text-muted">Argus agents stake on markets only. To trade tokens too, go back and pick pump.fun or Pons.</p>
            ) : (
              <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
                <span className="grid gap-0.5">
                  <span className="text-[14px] text-cream">{f.chain === "robinhood" ? "Trade Pons tokens (optional)" : "Trade tokens on Solana (optional)"}</span>
                  <span className="text-[12px] text-muted">Off by default. Turn on and pick a preset.</span>
                </span>
                <input type="checkbox" role="switch" className="switch" checked={t.enabled} onChange={(e) => setT({ enabled: e.target.checked })} />
              </label>
            )}
            {t.enabled && f.chain !== "arc" ? (
              <>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Preset">
                  {(Object.keys(chainPresets) as Preset[]).filter((k) => !demo || f.chain === "robinhood" || k === "trending").map((k) => (
                    <button key={k} type="button" aria-pressed={t.preset === k} onClick={() => setT({ preset: k, sources: [...chainPresets[k]!.sources], entry: chainPresets[k]!.entry.map((c) => ({ ...c })) })} className={`grid gap-1 rounded-xl p-3 text-left transition-colors ${t.preset === k ? "bg-cream text-ink" : "bg-cream/[0.04] text-cream hover:bg-cream/10"}`}>
                      <span className="text-[14px]">{strategiesFor(f.chain)[k]?.label}</span>
                      <span className={`text-[12px] ${t.preset === k ? "text-ink/70" : "text-muted"}`}>{strategiesFor(f.chain)[k]?.blurb}</span>
                    </button>
                  ))}
                </div>
                <p className="m-0 text-[13px] text-muted">
                  {strategiesFor(f.chain)[t.preset]?.label}: SL {t.risk.stopLossPct}% · TP {t.risk.takeProfitPct}% · daily cap {t.risk.maxDailyLossPct}% · {t.entry.length} entry rule{t.entry.length === 1 ? "" : "s"}.
                </p>
                <Disclosure summary="Fine-tune strategy" defaultOpen={Boolean(error)}>
                  <div className="grid gap-5">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sources">
                      {(Object.keys(sourcesFor(f.chain)) as DataSource[]).filter((s) => !demo || f.chain === "robinhood" || s === "dexscreener").map((s) => {
                        const on = t.sources.includes(s);
                        return <Chip key={s} active={on} onClick={() => setT({ sources: on ? t.sources.filter((x) => x !== s) : [...t.sources, s] })}>{sourcesFor(f.chain)[s]}</Chip>;
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
                        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(64px,100px)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_120px_auto]">
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
                  </div>
                </Disclosure>
              </>
            ) : null}
          </fieldset>
        ) : null}

        {step === 4 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Token &amp; fees</legend>
            {f.chain === "arc" ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Range label="Buy tax" value={f.argus.buyTaxPct} min={0} max={10} step={0.5} unit="%" onChange={(v) => set("argus", { ...f.argus, buyTaxPct: v })} />
                  <Range label="Sell tax" value={f.argus.sellTaxPct} min={0} max={10} step={0.5} unit="%" onChange={(v) => set("argus", { ...f.argus, sellTaxPct: v })} />
                </div>
                <p className="m-0 text-[13px] text-muted">
                  Tax + 1% pool fee in USDC. Argus / platform / AI take 30%; you split the rest. Keep holders at 0 on Argus for now.
                </p>
              </>
            ) : f.chain === "robinhood" ? (
              <p className="m-0 text-[14px] text-muted">
                Pons creator fees go to the agent as bankroll. Withdraw ETH from its page any time — no fee split to set.
              </p>
            ) : (
              <p className="m-0 text-[13px] text-muted">
                Creator fees fund the agent. Platform and AI take 20%; you split the other 80%. Defaults keep enough in gas &amp; bankroll.
              </p>
            )}
            {f.chain !== "robinhood" ? (
              <Disclosure summary="Fee split" defaultOpen={f.chain === "arc"}>
                <div className="grid gap-3">
                  <FeeAllocator value={f.allocation} onChange={(a) => set("allocation", a)} />
                  <p className="m-0 text-[12px] text-muted">Public on its page. Changes show at once and apply after 24 hours.</p>
                </div>
              </Disclosure>
            ) : null}
          </fieldset>
        ) : null}

        {step === 5 && demo ? (
          <div className="grid gap-5">
            <h2 className="m-0 font-display text-[1.5rem] text-cream">Start your preview agent</h2>
            <dl className="kv">
              <dt>Agent</dt><dd>{f.name} · {f.ticker}</dd>
              <dt>Network</dt><dd>{f.chain === "robinhood" ? "Robinhood" : f.chain === "arc" ? "Arc" : "Solana"}</dd>
              <dt>Trading</dt><dd>{t.enabled ? `SL ${t.risk.stopLossPct}% · TP ${t.risk.takeProfitPct}% · position ${t.risk.positionPct}%` : "Off"}</dd>
              <dt>Markets</dt><dd>{f.markets.enabled ? `Edge ≥ ${f.markets.minEdge} pts · ${f.markets.maxStakeUsdc} USDC per market` : "Off"}</dd>
              <dt>Virtual funds</dt><dd>{f.chain !== "arc" ? `${DEMO.initialNative} ${f.chain === "robinhood" ? "ETH" : "SOL"} + ` : ""}{DEMO.initialUsdc.toLocaleString()} USDC</dd>
              <dt>Duration</dt><dd>7 days · evaluated every 5 minutes</dd>
            </dl>
            <p className="m-0 text-[13px] leading-relaxed text-muted">Your wallet verifies ownership. No token launch or deposit. Paper fills use shared market snapshots and your slippage setting. Wallet tracking and social feeds are available in live mode.</p>
          </div>
        ) : null}
        {step === 5 && !demo ? (
          <div className="grid gap-5">
            <h2 className="m-0 font-display text-[1.5rem] text-cream">Check and launch</h2>
            <div className="flex items-center gap-4 rounded-xl bg-cream/[0.04] p-4 lg:hidden">
              <AgentFace seed={seed} size={56} mood="aiming" />
              <div className="min-w-0">
                <p className="m-0 truncate font-display text-[1.25rem] leading-none text-cream">{f.name}</p>
                <p className="m-0 mt-1 font-mono text-[12px] text-coral">${f.ticker}</p>
              </div>
            </div>
            <dl className="kv">
              <dt>Brain</dt>
              <dd>{f.brain === "mimir" ? "Mimir AI" : `${BYOK_PROVIDERS[f.brain].label} (your key)`}</dd>
              <dt>Markets</dt>
              <dd>
                {f.markets.enabled ? `edge ≥ ${f.markets.minEdge} pts · ≤ ${f.markets.maxStakeUsdc} USDC · budget ${f.markets.budgetUsdc}` : "off"}
                {f.markets.opens ? ` · opens ≤ ${f.markets.opensPerDay}/day` : ""}
              </dd>
              <dt>Trading</dt>
              <dd>{t.enabled ? `${strategiesFor(f.chain)[t.preset]?.label} · SL ${t.risk.stopLossPct}% · TP ${t.risk.takeProfitPct}%` : "off"}</dd>
              <dt>Token</dt>
              <dd>{f.chain === "arc" ? `Argus · ${f.argus.buyTaxPct}% / ${f.argus.sellTaxPct}% tax` : f.chain === "robinhood" ? "Pons on Robinhood Chain" : "pump.fun on Solana"}</dd>
              {f.chain !== "robinhood" ? (
                <>
                  <dt>Fees</dt>
                  <dd>
                    <AllocationBar allocation={f.allocation} className="mt-1 h-2.5 max-w-[280px]" />
                    {f.chain === "solana" ? <span className="mt-1 block text-[12px] text-muted">{perSol(f.allocation, { creator: "to you" })} per 1 SOL</span> : null}
                  </dd>
                </>
              ) : null}
            </dl>
            {f.chain === "arc" ? (
              <p className="m-0 rounded-xl bg-cream/[0.04] px-4 py-3 text-[14px] text-cream">After you sign, send {ARGUS_GAS_USDC} USDC on Arc to its Arc wallet for launch gas. No SOL needed.</p>
            ) : f.chain === "robinhood" ? (
              <>
                <Field label="Seed ETH" hint={`${RH_LAUNCH_FEE_ETH} ETH covers launch + gas; the rest is bankroll. ETH returns to this Robinhood wallet if you shut it down.`}>
                  <input className="input font-mono" inputMode="decimal" value={f.seedSol} onChange={(e) => set("seedSol", e.target.value)} />
                </Field>
                <div className="grid gap-2 rounded-xl bg-cream/[0.04] p-4">
                  <span className="text-[14px] text-cream">Your Robinhood wallet</span>
                  <RobinhoodConnect />
                </div>
                <p className="m-0 text-[14px] text-cream">You send {(Number(f.seedSol || 0) + RH_LAUNCH_FEE_ETH).toFixed(4)} ETH.</p>
              </>
            ) : (
              <>
                <Field label="Seed SOL" hint={`${LAUNCH_FEE_SOL} SOL mints the token; the rest is gas and bankroll. Fund Arc USDC from its page after launch.`}>
                  <input className="input font-mono" inputMode="decimal" value={f.seedSol} onChange={(e) => set("seedSol", e.target.value)} />
                </Field>
                <p className="m-0 text-[14px] text-cream">You send {(Number(f.seedSol || 0) + LAUNCH_FEE_SOL).toFixed(3)} SOL.</p>
              </>
            )}
            <p className="m-0 text-[12px] text-muted">Real mainnet funds. Pause, withdraw or shut down any time from its page.</p>
          </div>
        ) : null}

        {error ? <p role="alert" className="m-0 text-[14px] text-coral">{error}</p> : null}

        <div className="flex items-center justify-between border-t border-cream/10 pt-4">
          {step > 0 ? (
            <button type="button" className="text-[14px] text-muted hover:text-cream" onClick={() => go(flowSteps[stepIndex - 1])}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary !w-auto !px-6" onClick={() => go(flowSteps[stepIndex + 1])}>
              Continue
            </button>
          ) : publicKey ? (
            <button type="button" className="btn-primary !w-auto !px-6" onClick={() => { const p = validate(5); setError(p); if (!p) void run(); }}>
              {demo ? "Start preview agent" : "Sign and launch"}
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
