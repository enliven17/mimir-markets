/**
 * Mimir Launch: give every council persona its own Solana agent wallet (Privy, policy-locked: SOL only back to the
 * treasury) and its own pump.fun token, minted by that wallet as creator. The record (public: wallets, mints) goes to
 * lib/launch/council.json, which the launch page reads; the Arc side is the persona's existing council Circle wallet.
 *
 *   node --env-file=.env.local --env-file=.env.mainnet.local --import tsx scripts/launch/council-tokens.mts [slug ...]
 *
 * Env: PRIVY_*, PINATA_JWT, LAUNCH_SOLANA_TREASURY, SOLANA_MAINNET_RPC; ARC_COUNCIL_WALLETS (the Convex mainnet value);
 * LAUNCH_TREASURY_KEY (base58, optional) tops a wallet up from the treasury, else an unfunded wallet is skipped.
 * Idempotent: a persona with a mint is skipped; an unconfirmed launch stops the run for a manual check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";

import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { defaultTokenImage } from "../../lib/launch/token-image";
import { agentWalletPolicy } from "../../lib/launch/solana/policy";
import { solanaFromEnv } from "../../lib/launch/solana/env";

const FILE = "lib/launch/council.json";
/** Measured ~0.006 SOL for a pump.fun create on mainnet (rent + fees), plus a margin for the pre-sign simulation. */
const NEED_LAMPORTS = 6_800_000;
const TICKERS: Record<string, string> = {
  optimist: "OPTIMIST", pessimist: "PESSIMIST", contrarian: "CONTRARIAN", statistician: "STATS", "whale-watcher": "WHALE",
  "crypto-maxi": "MAXI", "sports-pundit": "PUNDIT", weatherman: "WEATHERMAN", doomer: "DOOMER", yapper: "YAPPER",
  socrates: "SOCRATES", kahneman: "KAHNEMAN", taleb: "TALEB", feynman: "FEYNMAN", munger: "MUNGER", ada: "LOVELACE",
  meadows: "MEADOWS", machiavelli: "PRINCE", aurelius: "AURELIUS", "lao-tzu": "LAOTZU",
};

type Entry = { name: string; ticker: string; solana?: { walletId: string; address: string }; arc: string | null; mint?: string; sig?: string; metadataUri?: string };

const e = process.env;
const solana = solanaFromEnv(e);
const arcWallets = JSON.parse(e.ARC_COUNCIL_WALLETS ?? "{}") as Record<string, { address: string }>;
const treasuryKey = e.LAUNCH_TREASURY_KEY ? Keypair.fromSecretKey(bs58.decode(e.LAUNCH_TREASURY_KEY)) : null;
if (treasuryKey && treasuryKey.publicKey.toBase58() !== solana.treasury) throw new Error("LAUNCH_TREASURY_KEY is not the treasury's key");

const record: Record<string, Entry> = (() => {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
})();
const save = () => writeFileSync(FILE, `${JSON.stringify(record, null, 2)}\n`);

const only = new Set(process.argv.slice(2));
for (const p of COUNCIL_PERSONAS) {
  if (only.size && !only.has(p.slug)) continue;
  const ticker = TICKERS[p.slug];
  if (!ticker) throw new Error(`no ticker for ${p.slug}`);
  const r: Entry = (record[p.slug] ??= { name: p.displayName, ticker, arc: arcWallets[p.slug]?.address ?? null });
  r.arc ??= arcWallets[p.slug]?.address ?? null;
  if (r.mint) {
    console.log(`${p.slug}: already $${r.ticker} ${r.mint}`);
    continue;
  }
  if (!r.solana) {
    const w = await solana.privy.createWalletWithPolicy((address) => agentWalletPolicy({ wallet: address, creator: solana.treasury, treasury: solana.treasury }));
    r.solana = { walletId: w.id, address: w.address };
    save();
    console.log(`${p.slug}: wallet ${w.address}`);
  }
  const have = await solana.connection.getBalance(new PublicKey(r.solana.address), "confirmed");
  if (have < NEED_LAMPORTS) {
    if (!treasuryKey) {
      console.log(`${p.slug}: needs ${(NEED_LAMPORTS - have) / 1e9} SOL at ${r.solana.address}, skipped`);
      continue;
    }
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: treasuryKey.publicKey, toPubkey: new PublicKey(r.solana.address), lamports: NEED_LAMPORTS - have }));
    const sig = await sendAndConfirmTransaction(solana.connection, tx, [treasuryKey], { commitment: "confirmed" });
    console.log(`${p.slug}: funded ${(NEED_LAMPORTS - have) / 1e9} SOL (${sig.slice(0, 10)}…)`);
  }
  try {
    const res = await solana.executor.launchToken({
      walletId: r.solana.walletId, wallet: r.solana.address, name: p.displayName.replace(/^The /, ""), symbol: ticker,
      description: `${p.displayName}, an AI agent on Mimir's council. ${p.bio} Stakes on Mimir markets from its own Arc wallet. mimirmarkets.xyz`,
      imageDataUrl: await defaultTokenImage(p.slug), devBuyLamports: 0n,
    });
    Object.assign(r, { mint: res.mint, sig: res.sig, metadataUri: res.metadataUri });
    save();
    console.log(`${p.slug}: launched $${ticker} ${res.mint} (${res.sig.slice(0, 10)}…)`);
  } catch (err) {
    console.error(`${p.slug}: launch failed: ${(err as Error).message}`);
    if ((err as { name?: string }).name === "AmbiguousSendError") {
      console.error("sent but not confirmed: check the wallet on chain before running again");
      break;
    }
  }
}
save();
