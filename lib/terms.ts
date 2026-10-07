/**
 * The terms a visitor accepts to use Mimir: the full list on /terms, the short form in the consent card
 * (components/legal/ConsentNotice.tsx). Bump TERMS_VERSION when the terms change, so everyone accepts again.
 */
export const TERMS_VERSION = "2026-10-08";
export const TERMS_UPDATED = "8 October 2026";

/** The short form, shown until accepted. */
export const TERMS_SUMMARY = [
  "You are 18 or older and use Mimir of your own free will, at your own risk.",
  "Prediction markets may be restricted where you live. Following your local law is your responsibility.",
  "Nothing here is financial, legal or investment advice. AI verdicts can be wrong.",
] as const;

export interface TermsSection {
  title: string;
  points: readonly string[];
}

export const TERMS: readonly TermsSection[] = [
  {
    title: "Your choice to use Mimir",
    points: [
      "You came to Mimir on your own initiative and use it of your own free will. Nobody asked, paid or pressured you to take part.",
      "By opening, browsing or using the site, the app, the CLI, the Telegram bot or the API, you accept these terms. If you do not accept them, do not use Mimir.",
      "You are at least 18 years old, or the age of majority where you live if that is higher, and you are able to enter into these terms.",
    ],
  },
  {
    title: "What Mimir is",
    points: [
      "Mimir is open-source software for prediction markets: people stake on the outcome of a claim, and an AI oracle proposes the result from public evidence. Markets settle on Arc; wallets and $MIMIR are on Solana.",
      "Mimir is a beta on Arc testnet. Stakes use test USDC with no monetary value. Contracts, data, balances and payouts can change or be reset at any time.",
      "Mimir does not hold your funds or keys. Your passkey stays on your device, your Solana wallet is yours, and transactions are signed by you.",
    ],
  },
  {
    title: "Your responsibility",
    points: [
      "Prediction markets, betting and related activity are restricted or prohibited in some countries and regions. It is your responsibility to know and follow the laws that apply to you, and you must not use Mimir where it is not allowed.",
      "You are responsible for your wallet, your passkey, your recovery phrase, your approvals and every transaction you sign. Lost keys or phrases cannot be recovered by Mimir.",
      "You are responsible for any taxes or reporting that apply to you.",
      "You will not use Mimir to break the law, manipulate markets, use inside information, attack the service or impersonate others.",
    ],
  },
  {
    title: "No advice, no guarantees",
    points: [
      "Nothing on Mimir is financial, investment, legal or tax advice. Markets, odds, council takes and agent output are information, not recommendations.",
      "Results are proposed by AI models from public sources and can be wrong, late or incomplete. The dispute window exists for that reason, and its outcome is final as recorded on chain.",
      "Mimir is provided as is and as available, without warranties of any kind. Software, smart contracts, networks, bridges, wallets and third-party services can fail, be attacked or change.",
    ],
  },
  {
    title: "Risk and liability",
    points: [
      "You can lose everything you stake. Only stake what you can afford to lose.",
      "To the fullest extent the law allows, the people behind Mimir are not liable for losses, missed gains, errors, outages, verdicts or the actions of other users, agents or third parties arising from your use of Mimir.",
      "Content and markets created by users and agents are their own. Mimir may hide content or limit access to protect users or the service.",
    ],
  },
  {
    title: "Changes",
    points: [
      "These terms can change. The date at the top shows the latest version, and you will be asked to accept again when they do. Continuing to use Mimir after a change means you accept it.",
    ],
  },
];
