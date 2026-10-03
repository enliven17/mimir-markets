/**
 * Mimir Terminal payments, the pure part (browser, server and worker).
 *
 * A paid agent's message is charged from the user's own USDC account through
 * an SPL Token spending limit (`approve`) the user grants the terminal's
 * delegate once. The settlement worker moves each batch: the agent's share to
 * its payout wallet, TERMINAL_FEE_BPS (0.5%) to Mimir. Nothing is deposited.
 *
 * Which wallet asks is proven by a terminal session: the wallet signs
 * `terminalSessionMessage` once, and every paid request carries it.
 */

/** Mimir's cut of a paid message, in basis points (0.5%). */
export const TERMINAL_FEE_BPS = 50;
export const TERMINAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const TERMINAL_WALLET_HEADER = "x-terminal-wallet";
export const TERMINAL_SESSION_HEADER = "x-terminal-session";
/** The spending limit a user is offered by default (USDC). */
export const DEFAULT_LIMIT_USDC = 5;
/**
 * Most a wallet may owe before it settles (1 USDC). Charges move after the
 * answer, so a user who burns a limit and revokes it before settlement leaves
 * agents unpaid: this caps how much.
 */
export const MAX_UNPAID_UNITS = 1_000_000n;

/** Split a charge: Mimir's fee rounds down, so the agent never gets less than its share. */
export function splitCharge(totalUnits: bigint, feeBps = TERMINAL_FEE_BPS): { agentUnits: bigint; feeUnits: bigint } {
  if (totalUnits <= 0n) return { agentUnits: 0n, feeUnits: 0n };
  const feeUnits = (totalUnits * BigInt(feeBps)) / 10_000n;
  return { agentUnits: totalUnits - feeUnits, feeUnits };
}

export function terminalSessionMessage(wallet: string, signedAt: number): string {
  return [
    "Mimir Terminal session",
    `wallet: ${wallet}`,
    `signedAt: ${signedAt}`,
    "Lets the Mimir Terminal charge the paid agents you message, within the USDC spending limit you approved. Expires in 12 hours. Revoke the limit any time with: limit revoke",
  ].join("\n");
}

/** `{signedAt, signature}` from the session header, or null when malformed or expired. */
export function parseSessionHeader(value: string | null | undefined, now = Date.now()): { signedAt: number; signature: string } | null {
  const m = /^(\d{12,14})\.([1-9A-HJ-NP-Za-km-z]{64,90})$/.exec((value ?? "").trim());
  if (!m) return null;
  const signedAt = Number(m[1]);
  if (signedAt > now + 5 * 60_000 || now - signedAt > TERMINAL_SESSION_TTL_MS) return null;
  return { signedAt, signature: m[2] };
}

/**
 * Can this wallet pay `priceUnits` more? Its approved limit must name our
 * delegate and cover what is already owed plus this message, and its balance
 * must too. A reason when it cannot.
 */
export function canAfford(args: {
  delegate: string | null;
  expectedDelegate: string;
  delegatedUnits: bigint;
  balanceUnits: bigint;
  owedUnits: bigint;
  priceUnits: bigint;
  maxUnpaidUnits?: bigint;
}): "ok" | "no_limit" | "limit_too_low" | "balance_too_low" | "settling" {
  const need = args.owedUnits + args.priceUnits;
  if (args.delegate !== args.expectedDelegate || args.delegatedUnits <= 0n) return "no_limit";
  if (args.owedUnits > 0n && need > (args.maxUnpaidUnits ?? MAX_UNPAID_UNITS)) return "settling";
  if (args.delegatedUnits < need) return "limit_too_low";
  if (args.balanceUnits < need) return "balance_too_low";
  return "ok";
}
