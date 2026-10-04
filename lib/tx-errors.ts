/**
 * One readable line for a failed Solana transaction.
 *
 * Wallet-adapter, web3.js and Anchor errors carry the useful part in different
 * places: a wallet rejection is a `Wallet*Error` wrapping the wallet's own
 * error, an Anchor error has `errorCode` / `errorMessage`, and a failed
 * simulation only has `custom program error: 0x…` buried in a multi-line
 * message plus logs. None of that belongs in a toast verbatim, and a user
 * rejecting the prompt is not a failure worth a stack trace at all.
 */
import idl from "./solana/idl/mimir.json";

const PROGRAM_ERRORS = new Map<number, { name: string; msg: string }>(
  ((idl as { errors?: Array<{ code: number; name: string; msg: string }> }).errors ?? []).map((e) => [
    e.code,
    { name: e.name, msg: e.msg },
  ]),
);

type ErrorLike = Record<string, unknown>;

/** The error, its `cause` chain and wallet-adapter's wrapped `error`, outermost first. */
function errorChain(err: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const queue: unknown[] = [err];
  while (queue.length && chain.length < 12) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || chain.includes(cur as ErrorLike)) continue;
    const e = cur as ErrorLike;
    chain.push(e);
    queue.push(e.cause, e.error);
  }
  return chain;
}

function text(e: ErrorLike): string {
  const logs = Array.isArray(e.logs) ? (e.logs as unknown[]).join("\n") : "";
  return `${String(e.message ?? "")}\n${String(e.errorMessage ?? "")}\n${logs}`;
}

/** The Mimir program error a failure carries, from Anchor fields or the raw hex code. */
export function programErrorOf(err: unknown): { code: number; name: string; msg: string } | null {
  for (const e of errorChain(err)) {
    const errorCode = e.errorCode as { number?: unknown } | undefined;
    const numeric = typeof errorCode?.number === "number" ? errorCode.number : null;
    const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text(e))?.[1];
    const code = numeric ?? (hex ? parseInt(hex, 16) : null);
    if (code !== null && PROGRAM_ERRORS.has(code)) return { code, ...PROGRAM_ERRORS.get(code)! };
  }
  return null;
}

export function txErrorMessage(err: unknown, fallback = "Transaction failed. Please try again."): string {
  const chain = errorChain(err);
  const all = chain.map(text).join("\n");

  const rejected = chain.some(
    (e) =>
      e.code === 4001 ||
      /user (rejected|denied|declined)|rejected the request|request was rejected/i.test(String(e.message ?? "")),
  );
  if (rejected) return "You rejected the request in your wallet.";

  if (chain.some((e) => e.name === "WalletNotConnectedError")) return "Connect a wallet first.";

  const program = programErrorOf(err);
  if (program) return `Transaction reverted: ${program.msg}`;

  if (/insufficient lamports|no record of a prior credit|insufficient funds for (fee|rent)/i.test(all)) {
    return "Not enough SOL in your wallet to pay the network fee.";
  }
  if (/custom program error: 0x1\b|insufficient funds/i.test(all)) {
    return "Not enough USDC for this transaction.";
  }
  if (/block ?height exceeded|blockhash not found|TransactionExpired/i.test(all + chain.map((e) => String(e.name ?? "")).join(" "))) {
    return "The transaction expired before it landed. Please try again.";
  }

  for (const e of chain) {
    if (typeof e.errorMessage === "string" && e.errorMessage) return `Transaction reverted: ${e.errorMessage}`;
  }
  // web3.js builds this when Anchor hands it a failed send in the old (message, logs) form: the real cause is lost.
  if (/^Unknown action '/.test(String(chain[0]?.message ?? ""))) {
    return "The transaction failed before it landed. Check your USDC and SOL balance and try again.";
  }
  const first = chain[0]?.message;
  if (typeof first === "string" && first.trim()) return first.trim().split("\n")[0].slice(0, 200);
  return fallback;
}
