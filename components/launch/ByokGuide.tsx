"use client";

/** The launch wizard's "bring your own key" guide: shown once a provider is picked instead of Mimir AI. */
import { ExternalMark } from "@/components/ExternalMark";
import { BYOK_PROVIDERS, type ByokProvider } from "@/lib/launch/byok-providers";

const WHERE: Record<ByokProvider, { url: string; looks: string; note: string }> = {
  openai: { url: "https://platform.openai.com/api-keys", looks: "sk-…", note: "Add a payment method first; new accounts without credit get refused." },
  anthropic: { url: "https://console.anthropic.com/settings/keys", looks: "sk-ant-…", note: "Needs prepaid credits in the console." },
  gemini: { url: "https://aistudio.google.com/apikey", looks: "AIza…", note: "Free tier works but runs out fast; a billed project is steadier." },
  groq: { url: "https://console.groq.com/keys", looks: "gsk_…", note: "Very fast, with a generous free tier." },
  openrouter: { url: "https://openrouter.ai/keys", looks: "sk-or-…", note: "One key for many models; type any OpenRouter model id below." },
};

export default function ByokGuide({ provider }: { provider: ByokProvider }) {
  const p = BYOK_PROVIDERS[provider];
  const w = WHERE[provider];
  return (
    <div className="grid gap-3 rounded-xl bg-cream/[0.04] p-4 text-[13px] leading-relaxed text-muted">
      <p className="m-0 text-[14px] text-cream">How to connect your {p.label} key</p>
      <ol className="m-0 grid gap-1.5 pl-5">
        <li>
          Open{" "}
          <a href={w.url} target="_blank" rel="noreferrer" className="text-coral hover:underline">
            {p.label} API keys <ExternalMark />
          </a>{" "}
          and create a new key just for this agent. It looks like <span className="font-mono text-cream">{w.looks}</span>.
        </li>
        <li>Set a monthly spending limit there. That cap is yours; Mimir can never go past it.</li>
        <li>
          Paste the key below. Leave the model empty for <span className="font-mono text-cream">{p.model}</span>, or type another model your key can use.
        </li>
        <li>We send one short test call. If {p.label} refuses the key or the model, nothing is saved and no wallet is made.</li>
      </ol>
      <p className="m-0">{w.note}</p>
      <p className="m-0">
        What happens to it: the key is encrypted on our server and tied to this one agent, and you only ever see its last four characters again. It is used only for this
        agent&apos;s own decisions: judging markets every ten minutes, and ranking tokens when trading is on (a few hundred to a few thousand short calls a day). If {p.label}{" "}
        starts refusing it, the agent pauses and tells you; it never falls back to Mimir&apos;s keys. To stop using it, shut the agent down or revoke the key at {p.label}.
      </p>
    </div>
  );
}
