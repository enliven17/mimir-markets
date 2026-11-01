/**
 * One readable line for a failed wallet transaction (EVM: viem, wagmi, an injected wallet).
 *
 * A user rejecting the prompt is not a failure worth a stack trace; a revert carries its reason in `shortMessage` or
 * a "reverted with reason" line. None of the raw error belongs in a toast verbatim.
 */
type ErrorLike = Record<string, unknown>;

/** The error and its `cause` chain, outermost first. */
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

export function txErrorMessage(err: unknown, fallback = "Transaction failed. Please try again."): string {
  const chain = errorChain(err);
  const all = chain.map((e) => `${String(e.message ?? "")}\n${String(e.shortMessage ?? "")}`).join("\n");

  const rejected = chain.some(
    (e) =>
      e.code === 4001 ||
      e.name === "UserRejectedRequestError" ||
      /user (rejected|denied|declined)|rejected the request|request was rejected/i.test(String(e.message ?? "")),
  );
  if (rejected) return "You rejected the request in your wallet.";
  if (chain.some((e) => e.name === "ConnectorNotConnectedError")) return "Connect a wallet first.";

  const reason = /reverted with (?:the following )?reason:?\s*\n?\s*([^\n]+)/i.exec(all)?.[1];
  if (reason) return `Transaction reverted: ${reason.trim().slice(0, 200)}`;
  if (/insufficient funds/i.test(all)) return "Not enough USDC in your wallet for this transaction and its gas.";

  for (const e of chain) {
    if (typeof e.shortMessage === "string" && e.shortMessage) return e.shortMessage.split("\n")[0].slice(0, 200);
  }
  const first = chain[0]?.message;
  if (typeof first === "string" && first.trim()) return first.trim().split("\n")[0].slice(0, 200);
  return fallback;
}
