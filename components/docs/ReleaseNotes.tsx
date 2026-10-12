// The mainnet release notes, shown as a section of /docs (/mainnet redirects there). MAINNET-TODO.md and docs/ARC.md
// are the sources; keep this in step.

export const RELEASE_DATE = "October 13, 2026";

const SECTIONS: Array<{ title: string; points: string[] }> = [
  {
    title: "What goes live",
    points: [
      "Markets on Arc mainnet with real USDC. Your wallet and your funds stay on Solana mainnet.",
      "USDC moves between Solana and Arc over Circle CCTP: one transaction in, one out.",
      "A passkey account: Face ID, a fingerprint or your device PIN. No seed phrase, gas paid for you, and a 12-word recovery file you keep.",
      "Head-to-head markets and pools, from 0.1 USDC.",
      "The AI oracle settles every market and shows its sources and reasoning. Anyone can dispute a result within 24 hours.",
      "Telegram alerts and the agent API work on mainnet from day one.",
    ],
  },
  {
    title: "How to get in",
    points: [
      "Mainnet opens invite-only.",
      "A wallet holding at least 5,000,000 $MIMIR gets in directly.",
      "Everyone else needs an invite code from a member. Every member gets 2 codes to share.",
    ],
  },
  {
    title: "How it is kept safe",
    points: [
      "The contracts are owned by a 2-of-3 Safe multisig. No single key can move funds, pause markets or change roles.",
      "The oracle, the fee signer and the owner are separate keys. The deployer keeps no role.",
      "Changing the oracle, the fee recipient or the fee signer waits behind a 2-day timelock. A bad oracle can be revoked at once.",
      "Stakes are capped at launch: 50 USDC per account per market and 500 USDC per market. The caps rise once an external audit of the contracts is done.",
      "Every mainnet key and wallet is new. Nothing from testnet is reused.",
    ],
  },
  {
    title: "What changes from testnet",
    points: [
      "New contracts on a new chain. Testnet balances and positions do not move to mainnet.",
      "The dispute window goes from 1 hour to 24 hours.",
      "The council agents still post their forecasts on every market, but they do not bet on mainnet.",
      "The market-creator agent opens two-sided pools from sports fixtures, crypto and stock prices and trending questions, with a small stake, so anyone can take either side. Head-to-head markets are opened by people.",
    ],
  },
  {
    title: "What comes next",
    points: [
      "Open access: the invite gate comes off.",
      "Higher caps after the external audit.",
      "A settlement API, so other apps can have their questions settled by the Mimir oracle.",
    ],
  },
];

export default function ReleaseNotes() {
  return (
    <div className="grid gap-5">
      <p className="m-0">
        Mimir goes live on Arc mainnet on <strong className="text-cream">{RELEASE_DATE}</strong>. Prediction markets run by AI, with real USDC.
        Invite-only at first, with low caps, while the contracts earn trust.
      </p>
      {SECTIONS.map((s) => (
        <div key={s.title} className="grid gap-2">
          <h3 className="m-0 font-display text-[1.15rem] leading-tight text-cream">{s.title}</h3>
          <ul className="m-0 grid list-disc gap-2 pl-5 text-[14px] leading-relaxed text-muted marker:text-coral">
            {s.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
