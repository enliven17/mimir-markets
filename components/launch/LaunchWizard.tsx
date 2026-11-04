"use client";

/**
 * /launch/new: create a hosted agent. Free: four steps (who it is, its brain, how it stakes on Mimir markets, a
 * check), then one signature. The server makes its Arc wallet and it is live at once; it stakes once its owner sends
 * it USDC from its page. Its own token is optional and launched later from the agent's page, from the owner's wallet.
 */
import { useState } from "react";

import Chip from "@/components/ui/Chip";
import Disclosure from "@/components/ui/Disclosure";
import Slider from "@/components/ui/Slider";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { Link } from "@/i18n/navigation";
import { BODIES, COLOURS, EYES, PALETTE, avatarFromSeed, encodeAvatarSeed, type AvatarPicks } from "@/lib/avatar";
import { BYOK_PROVIDERS, type ByokProvider } from "@/lib/launch/byok-providers";
import { signedPost } from "@/lib/launch/client";
import { trackProductEvent } from "@/lib/product-analytics";
import { CATEGORIES } from "@/lib/constants";
import { AGENT_MARKETS_PER_DAY_MAX } from "@/lib/launch/agent-markets-limit";
import AgentFace from "./AgentFace";
import ByokGuide from "./ByokGuide";

const STEPS = ["Identity", "Brain", "Markets", "Create"] as const;

const INITIAL = {
  name: "", ticker: "", avatar: {} as AvatarPicks,
  thesis: "",
  brain: "mimir" as "mimir" | ByokProvider, apiKey: "", model: "",
  markets: { enabled: true, categories: [] as string[], minEdge: 8, kellyFraction: 25, maxStakeUsdc: 5, budgetUsdc: 20, maxHoursToClose: 72, opens: false, opensPerDay: 1 },
};
type Form = typeof INITIAL;

const faceBase = (f: Form) => f.ticker.toLowerCase() || "agent";

function problems(step: number, f: Form): string | null {
  if (step >= 0) {
    if (f.name.trim().length < 2) return "Give it a name (2 to 32 characters).";
    if (!/^[A-Z0-9]{2,10}$/.test(f.ticker)) return "The ticker is 2 to 10 letters or digits.";
  }
  if (step >= 1 && f.brain !== "mimir" && f.apiKey.trim().length < 16) return "Paste the API key, or use Mimir AI.";
  if (step >= 2 && !f.markets.enabled && !f.markets.opens) return "Turn on staking.";
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

export default function LaunchWizard() {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; solana: string | null; arc: string | null; base: string | null } | null>(null);
  // The connected EVM wallet owns the agent (lib/launch/auth.ts).
  const { address: owner0, signMessage } = useMimirWallet();
  const { open } = useWalletSheet();
  const seed = encodeAvatarSeed(faceBase(f), f.avatar);
  const spec = avatarFromSeed(seed);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const setM = (p: Partial<Form["markets"]>) => setF((x) => ({ ...x, markets: { ...x.markets, ...p } }));

  const go = (to: number) => {
    const p = to > step ? problems(step, f) : null;
    setError(p);
    if (!p) setStep(to);
  };

  const body = () => ({
    name: f.name.trim(), ticker: f.ticker, thesis: f.thesis, avatarSeed: seed,
    brain: f.brain === "mimir" ? { kind: "mimir" } : { kind: "byok", provider: f.brain, apiKey: f.apiKey.trim(), ...(f.model.trim() ? { model: f.model.trim() } : {}) },
    markets: { enabled: f.markets.enabled, categories: f.markets.categories, minEdge: f.markets.minEdge / 100, kellyFraction: f.markets.kellyFraction / 100, maxStakeUsdc: f.markets.maxStakeUsdc, budgetUsdc: f.markets.budgetUsdc, maxHoursToClose: f.markets.maxHoursToClose, create: { enabled: f.markets.opens, perDay: f.markets.opensPerDay } },
  });

  const run = async () => {
    if (!owner0 || !signMessage) return setError("Connect your wallet first.");
    setBusy(true);
    setError(null);
    try {
      const r = await signedPost<{ id: string; solana: string | null; arc: string | null; base: string | null }>("/api/launch", { owner: owner0, signMessage, action: "create", agent: "new", body: body() });
      trackProductEvent("live_agent_created", { mode: "live", chain: "solana" });
      setCreated(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create the agent.";
      setError(/reject|denied|cancel/i.test(msg) ? "You declined it in your wallet." : msg);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto grid w-full max-w-[640px] gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-6 shadow-card">
        <div className="flex items-center gap-4">
          <AgentFace seed={seed} size={64} mood="won" />
          <div>
            <p className="m-0 font-display text-[1.6rem] leading-none text-cream">{f.name}</p>
            <p className="m-0 mt-1 font-mono text-[13px] text-coral">${f.ticker}</p>
          </div>
        </div>
        <p className="m-0 text-[14px] text-cream">{f.name} is live. Send it USDC and a little devnet SOL for gas from its page and it starts staking. You can withdraw any time.</p>
        <p className="m-0 break-all rounded-xl bg-ink-deep px-3 py-2 font-mono text-[12px] text-muted">{created.solana}</p>
        <p className="m-0 text-[13px] text-muted">Want a token for it? Launch one on Argus or Clanker from its page: your wallet launches it and every creator fee is yours.</p>
        <Link href={`/launch/${created.id}`} className="btn-primary justify-self-start !w-auto !px-5">
          Open its page
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6">
      <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-[12px] text-muted lg:hidden">
            <span>
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-cream">{STEPS[step]}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-cream/10 lg:hidden" aria-hidden>
            <div className="h-full rounded-full bg-coral transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <ol className="m-0 hidden list-none gap-1 p-0 lg:grid" aria-label="Steps">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${i === step ? "bg-cream text-ink" : i < step ? "bg-cream/[0.06] text-cream hover:bg-cream/10" : "text-dim"}`}
                >
                  <span className="font-mono text-[12px]">0{i + 1}</span>
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="hidden items-center gap-3 rounded-2xl bg-cream/[0.04] p-4 lg:flex">
          <AgentFace seed={seed} size={56} mood={step === 1 ? "thinking" : step === 3 ? "aiming" : "neutral"} />
          <div className="min-w-0">
            <p className="m-0 truncate font-display text-[1.2rem] leading-none text-cream">{f.name || "Your agent"}</p>
            <p className="m-0 mt-1 font-mono text-[12px] text-coral">${f.ticker || "TICKER"}</p>
          </div>
        </div>
      </aside>

      <div className="grid gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-5 shadow-card sm:gap-6 sm:p-6">
        {step === 0 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Who is it?</legend>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Name">
                <input className="input" value={f.name} maxLength={32} onChange={(e) => set("name", e.target.value)} placeholder="Njord" />
              </Field>
              <Field label="Ticker">
                <input className="input font-mono" value={f.ticker} maxLength={10} onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="NJORD" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4 rounded-xl bg-cream/[0.04] p-4">
              <AgentFace seed={seed} size={72} />
              <div className="grid min-w-0 flex-1 gap-2">
                <p className="m-0 text-[14px] text-cream">Its face</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button type="button" className="text-[13px] text-coral hover:underline" onClick={() => set("avatar", { ...f.avatar, reroll: (f.avatar.reroll ?? 0) + 1 })}>
                    Reroll face
                  </button>
                </div>
              </div>
            </div>
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
          </fieldset>
        ) : null}

        {step === 1 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Its brain</legend>
            <p className="m-0 -mt-2 text-[13px] text-muted">Mimir AI is included. Bring your own key only if you want a different model.</p>
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
            <Field label="Thesis" hint="Optional. Steers how it judges markets; your rules still bind it.">
              <textarea className="input min-h-[5rem]" rows={3} maxLength={600} value={f.thesis} onChange={(e) => set("thesis", e.target.value)} placeholder="Back strong favourites in football, avoid coin flips." />
            </Field>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <fieldset className="m-0 grid gap-5 border-0 p-0">
            <legend className="mb-1 font-display text-[1.5rem] text-cream">Mimir markets</legend>
            <label className="flex items-center justify-between gap-4 rounded-xl bg-cream/[0.04] px-4 py-3">
              <span className="grid gap-0.5">
                <span className="text-[14px] text-cream">Stake from its Arc wallet</span>
                <span className="text-[12px] text-muted">Fund it with USDC on its page once it exists.</span>
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
          <div className="grid gap-5">
            <h2 className="m-0 font-display text-[1.5rem] text-cream">Check and create</h2>
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
              <dt>Cost</dt>
              <dd>Free. It stakes the USDC you send it on Solana Devnet.</dd>
            </dl>
            <p className="m-0 text-[12px] text-muted">One signature from your wallet, no transaction. Pause, withdraw or shut it down any time from its page.</p>
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
          ) : owner0 ? (
            <button type="button" disabled={busy} className="btn-primary !w-auto !px-6" onClick={() => { const p = problems(3, f); setError(p); if (!p) void run(); }}>
              Sign and create
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
