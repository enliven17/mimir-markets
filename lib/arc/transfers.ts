/**
 * Deposit (Solana → Arc) and withdraw (Arc → Solana) over CCTP V2, end to
 * end, with progress: signing → attesting → receiving → done.
 *
 * Once the burn lands the money is in flight: it is remembered as a pending
 * transfer (localStorage, browser only) until the mint on the other side is
 * confirmed, so a closed tab or a failed mint can be finished later with
 * `finishDeposit` / `finishWithdraw`. The attested message can only mint to
 * the recipient in it, so finishing twice just fails the second time.
 */
import type { Connection } from "@solana/web3.js";

import type { ArcSession } from "./account";
import { receiveMessageCall, withdrawToSolanaCalls } from "./cctp-arc";
import { burnToArc, ensureUsdcAta, receiveOnSolana, solanaUsdcAta, type SolanaSigner } from "./cctp-solana";
import { ARC, arcExplorerUrl, solanaExplorerUrl, type ArcConfig } from "./config";
import { formatUsdcUnits, solanaAddressToBytes32 } from "./encoding";
import { fastMaxFee, pollAttestation, type AttestationResult, type PollOptions } from "./iris";

export type TransferKind = "deposit" | "withdraw";
export type TransferStep = "signing" | "attesting" | "receiving" | "done";

export interface TransferProgress {
  step: TransferStep;
  sourceTx?: string;
  sourceUrl?: string;
  destTx?: string;
  destUrl?: string;
}

export interface PendingTransfer {
  kind: TransferKind;
  /** The burn: a Solana signature for a deposit, an Arc tx hash for a withdrawal. */
  tx: string;
  /** Human amount, for the "finish your transfer" line. */
  amount: string;
  at: number;
}

export interface TransferDeps {
  /** Attestation lookup for (source domain, burn tx). The browser goes through /api/arc/attestation. */
  attestation: (domain: number, tx: string) => Promise<AttestationResult>;
  onProgress?: (p: TransferProgress) => void;
  poll?: PollOptions;
  config?: ArcConfig;
}

// ── pending transfers (browser only; a no-op in node) ───────────────────────────
const pendingKey = (config: ArcConfig) => `mimir:arc:pending:${config.network}`;
const hasStorage = () => typeof localStorage !== "undefined";

export function loadPendingTransfers(config: ArcConfig = ARC): PendingTransfer[] {
  if (!hasStorage()) return [];
  try {
    const list = JSON.parse(localStorage.getItem(pendingKey(config)) ?? "[]") as PendingTransfer[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.tx === "string" && (p.kind === "deposit" || p.kind === "withdraw")) : [];
  } catch {
    return [];
  }
}

function savePending(p: PendingTransfer, config: ArcConfig): void {
  if (!hasStorage()) return;
  const rest = loadPendingTransfers(config).filter((x) => x.tx !== p.tx);
  localStorage.setItem(pendingKey(config), JSON.stringify([...rest, p]));
}

export function forgetPendingTransfer(tx: string, config: ArcConfig = ARC): void {
  if (!hasStorage()) return;
  localStorage.setItem(pendingKey(config), JSON.stringify(loadPendingTransfers(config).filter((x) => x.tx !== tx)));
}

// ── deposit: Solana → Arc ────────────────────────────────────────────────────
export async function deposit(
  args: { connection: Connection; signer: SolanaSigner; session: ArcSession; amount: bigint; feeBps: number },
  deps: TransferDeps,
): Promise<TransferProgress> {
  const config = deps.config ?? ARC;
  const { connection, signer, session, amount, feeBps } = args;
  deps.onProgress?.({ step: "signing" });
  const sig = await burnToArc({ connection, signer, amount, arcRecipient: session.address, maxFee: fastMaxFee(amount, feeBps), config });
  savePending({ kind: "deposit", tx: sig, amount: formatUsdcUnits(amount), at: Date.now() }, config);
  return finishDeposit({ tx: sig, session }, deps);
}

/** Wait for the attestation of a Solana burn and mint it into the Arc account (sponsored). */
export async function finishDeposit(args: { tx: string; session: ArcSession }, deps: TransferDeps): Promise<TransferProgress> {
  const config = deps.config ?? ARC;
  const source = { sourceTx: args.tx, sourceUrl: solanaExplorerUrl("tx", args.tx, config) };
  deps.onProgress?.({ step: "attesting", ...source });
  const att = await pollAttestation(() => deps.attestation(config.cctp.domains.solana, args.tx), deps.poll);
  deps.onProgress?.({ step: "receiving", ...source });
  const { txHash } = await args.session.sendCalls([receiveMessageCall(att.message, att.attestation, config)]);
  forgetPendingTransfer(args.tx, config);
  const done: TransferProgress = { step: "done", ...source, destTx: txHash, destUrl: arcExplorerUrl("tx", txHash, config) };
  deps.onProgress?.(done);
  return done;
}

// ── withdraw: Arc → Solana ───────────────────────────────────────────────────
export async function withdraw(
  args: { connection: Connection; signer: SolanaSigner; session: ArcSession; amount: bigint },
  deps: TransferDeps,
): Promise<TransferProgress> {
  const config = deps.config ?? ARC;
  const { connection, signer, session, amount } = args;
  deps.onProgress?.({ step: "signing" });
  const ata = solanaUsdcAta(signer.publicKey, config);
  const { txHash } = await session.sendCalls(withdrawToSolanaCalls(amount, solanaAddressToBytes32(ata.toBase58()), config));
  savePending({ kind: "withdraw", tx: txHash, amount: formatUsdcUnits(amount), at: Date.now() }, config);
  return finishWithdraw({ tx: txHash, connection, signer }, deps);
}

/** Wait for the attestation of an Arc burn and mint it on Solana into the signer's USDC account. */
export async function finishWithdraw(
  args: { tx: string; connection: Connection; signer: SolanaSigner },
  deps: TransferDeps,
): Promise<TransferProgress> {
  const config = deps.config ?? ARC;
  const { connection, signer } = args;
  const source = { sourceTx: args.tx, sourceUrl: arcExplorerUrl("tx", args.tx, config) };
  deps.onProgress?.({ step: "attesting", ...source });
  const att = await pollAttestation(() => deps.attestation(config.cctp.domains.arc, args.tx), deps.poll);
  deps.onProgress?.({ step: "receiving", ...source });
  await ensureUsdcAta({ connection, signer, owner: signer.publicKey, config });
  const sig = await receiveOnSolana({
    connection,
    signer,
    message: att.message,
    attestation: att.attestation,
    recipientAta: solanaUsdcAta(signer.publicKey, config),
    config,
  });
  forgetPendingTransfer(args.tx, config);
  const done: TransferProgress = { step: "done", ...source, destTx: sig, destUrl: solanaExplorerUrl("tx", sig, config) };
  deps.onProgress?.(done);
  return done;
}
