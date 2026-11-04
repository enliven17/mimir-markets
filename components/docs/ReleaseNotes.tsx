// The release notes, shown as a section of /docs (/mainnet redirects there), newest first. MAINNET-TODO.md, docs/CHAINS.md
// and the Launch code (lib/launch, convex/launch*.ts) are the sources; keep this in step.

type Release = {
  date: string;
  title: string;
  intro: string;
  sections: Array<{ title: string; points: string[] }>;
};

const RELEASES: Release[] = [
  {
    date: "November 4, 2026",
    title: "Mimir on Solana Devnet",
    intro:
      "The current Mimir experience, running through native Solana instructions with a dedicated Convex backend. All stakes and payouts use test USDC.",
    sections: [
      {
        title: "Native accounts and settlement",
        points: [
          "Connect Phantom, Solflare or Backpack. Your Solana public key is your account; you approve every personal transaction.",
          "Create and challenge public VS markets from 2 test USDC. Full stakes enter escrow; frozen fees apply only to positive profit.",
          "The oracle proposes evidence-backed outcomes, participants can dispute, and native payout instructions settle eligible positions.",
        ],
      },
      {
        title: "Agents and copies",
        points: [
          "Create a free hosted agent with its own encrypted devnet wallet. Fund it with test USDC and devnet SOL; set its risk limits and control it with your signature.",
          "Follow agents through separately funded copy wallets. Owner-only withdrawals return funds to the recorded owner.",
          "External agents authenticate with Ed25519 and receive unsigned Solana transactions.",
        ],
      },
      {
        title: "Current product tools",
        points: [
          "Public agent records, Strategy Lab, Council Radar, daily checkpoints and basket signals use the native market index.",
          "Portfolio includes unused program USDC and lets you withdraw it to your connected wallet.",
          "Market activity links to the correct devnet execution layer.",
        ],
      },
    ],
  },
];

export default function ReleaseNotes() {
  return (
    <div className="grid gap-10">
      {RELEASES.map((r) => (
        <div key={r.date} className="grid gap-5">
          <div className="grid gap-1">
            <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">
              {r.date}
            </p>
            <h3 className="m-0 font-display text-[1.4rem] leading-tight text-cream">
              {r.title}
            </h3>
          </div>
          <p className="m-0">{r.intro}</p>
          {r.sections.map((s) => (
            <div key={s.title} className="grid gap-2">
              <h4 className="m-0 font-display text-[1.1rem] leading-tight text-cream">
                {s.title}
              </h4>
              <ul className="m-0 grid list-disc gap-2 pl-5 text-[14px] leading-relaxed text-muted marker:text-coral">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
