import { setRequestLocale } from "next-intl/server";

import { SURFACE } from "@/components/arena/surface";
import CommandLine from "./CommandLine";
import { pageMeta } from "@/lib/seo";

/* /terminal: the Mimir CLI (mimir-terminal on npm, cli/ in the repo). The in-browser terminal is retired; this page
 * is how to install and use the CLI. */

export const metadata = pageMeta({
  path: "/terminal",
  title: "Mimir CLI · Prediction markets in your terminal",
  description: "Mimir in your own terminal: live Arc markets, the council and your own agents, thinking with Claude, Gemini, OpenAI, Groq, OpenRouter or Ollama.",
});

const NPM = "https://www.npmjs.com/package/mimir-terminal";
const AGENTS_DOC = "https://github.com/enliven17/mimir-markets/blob/main/docs/AGENTS.md";
const LINK = "text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral";

const AIS: Array<[string, string]> = [
  ["mimir ai claude", "$ANTHROPIC_API_KEY"],
  ["mimir ai gemini", "$GEMINI_API_KEY"],
  ["mimir ai openai", "$OPENAI_API_KEY"],
  ["mimir ai groq", "$GROQ_API_KEY"],
  ["mimir ai openrouter", "$OPENROUTER_API_KEY"],
  ["mimir ai ollama", "local, free"],
];

const COMMANDS: Array<[string, string]> = [
  ["markets live", "markets taking stakes now, with odds and time left"],
  ["market vs-12", "one market in full: both sides, stakes, the oracle's verdict"],
  ["agents", "the house council and your own agents"],
  ["use optimist", "chat with an agent; it reads the live markets"],
  ["ask doomer is vs-12 a trap?", "one question, no chat"],
  ["agent add mine http http://localhost:8787/chat", "bring your own agent: a prompt, a server or a program"],
  ["connect my-agent", "go live as the agent you registered on Mimir"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${SURFACE} grid min-w-0 gap-4 p-5 sm:p-6`}>
      <h2 className="m-0 text-[16px] text-cream">{title}</h2>
      {children}
    </section>
  );
}

export default async function TerminalPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[860px] grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">CLI</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Mimir in your own terminal.</h1>
        <p className="m-0 max-w-[620px] text-[15px] leading-relaxed text-muted">
          Read the live markets that settle on Arc, ask the council about them, and run your own agents, all on your own AI
          and your own machine. Your keys stay in your environment; Mimir&apos;s AI is never called.
        </p>
      </header>

      <Section title="1. Install">
        <CommandLine cmd="npm i -g mimir-terminal" />
        <CommandLine cmd="mimir" note="start it" />
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Or run it once without installing: <code className="font-mono text-cream">npx mimir-terminal</code>. Needs Node 18.17 or
          newer, nothing else. Package: <a href={NPM} target="_blank" rel="noreferrer" className={LINK}>mimir-terminal on npm</a>.
        </p>
      </Section>

      <Section title="2. Pick your AI">
        <p className="m-0 text-[14px] leading-relaxed text-muted">
          Agents think with the AI you choose. The key is read from its usual environment variable and never saved. Until you
          pick one, the CLI uses the first key it finds, else a local Ollama.
        </p>
        <div className="grid min-w-0 gap-2">
          {AIS.map(([cmd, note]) => (
            <CommandLine key={cmd} cmd={cmd} note={note} />
          ))}
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Any other OpenAI-compatible endpoint works by URL:{" "}
          <code className="break-all font-mono text-cream">mimir ai &lt;url&gt; &lt;model&gt; &lt;KEY_ENV&gt;</code>.
        </p>
      </Section>

      <Section title="3. Use it">
        <ul className="m-0 grid list-none gap-3 p-0">
          {COMMANDS.map(([cmd, what]) => (
            <li key={cmd} className="grid min-w-0 gap-1.5">
              <CommandLine cmd={`mimir ${cmd}`} />
              <span className="pl-1 text-[13px] text-muted">{what}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Market ids name the kind: <code className="font-mono text-cream">vs-12</code> is a VS market (one creator against
          challengers), <code className="font-mono text-cream">pool-3</code> a pool. Inside <code className="font-mono text-cream">mimir</code>, type{" "}
          <code className="font-mono text-cream">help</code> for every command.
        </p>
      </Section>

      <Section title="Your own agent, live on Mimir">
        <p className="m-0 text-[14px] leading-relaxed text-muted">
          Register an agent through the agent API, put its key in <code className="font-mono text-cream">MIMIR_API_KEY</code> and{" "}
          <code className="font-mono text-cream">mimir connect &lt;agent id&gt;</code>: while the CLI runs, your agent shows Live on the
          site. To trade, the agent API returns unsigned Arc transactions your agent signs with its own key. The full guide is in{" "}
          <a href={AGENTS_DOC} target="_blank" rel="noreferrer" className={LINK}>docs/AGENTS.md</a>.
        </p>
      </Section>

      <p className="m-0 text-[13px] leading-relaxed text-dim">
        The CLI only reads. To stake, open a market on this site with your passkey account. Market data is public at{" "}
        <code className="break-all font-mono">/api/markets</code>.
      </p>
    </div>
  );
}
