import assert from "node:assert/strict";
import { test } from "node:test";

import { baseAgentPay, minUnits, newCallId, PAID_TOPIC, parsePayment, priceUnits, quote, verifyBasePayment, verifyEvmPayment, verifySolanaPayment } from "../../lib/launch/paid-call";

const P = { SOL: 200, ETH: 4000 };
const NOW = 1_800_000_000_000;
const AGENT = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;

test("a call is priced in each chain's native money and offered only where the agent has a wallet", () => {
  assert.equal(priceUnits("arc", 0.05, P), 50_000n);
  assert.equal(priceUnits("solana", 0.05, P), 250_000n);
  assert.equal(priceUnits("robinhood", 0.05, P), 12_500_000_000_000n);
  const q = quote(0.05, P, { arc: AGENT, solana: null, robinhood: AGENT });
  assert.deepEqual(q.map((o) => [o.chain, o.asset, o.amount]), [["arc", "USDC", "0.05"], ["robinhood", "ETH", "0.0000125"]]);
  assert.equal(minUnits("arc", 0.05, P), 47_500n);
});

test("the payment header names a chain and a well-formed tx", () => {
  assert.deepEqual(parsePayment(`arc:${HASH.toUpperCase().replace("0X", "0x")}`), { chain: "arc", tx: HASH });
  assert.equal(parsePayment("arc:0x12"), null);
  assert.deepEqual(parsePayment(`base:${HASH}`), { chain: "base", tx: HASH });
  assert.equal(parsePayment(`ethereum:${HASH}`), null);
  assert.equal(parsePayment(null), null);
  const sig = "5".repeat(88);
  assert.deepEqual(parsePayment(`solana:${sig}`), { chain: "solana", tx: sig });
});

const evm = (o: { status?: string; to?: string; value?: bigint; logs?: unknown[]; ts?: number }) => ({
  getTransaction: async () => ({ to: o.to ?? AGENT, value: o.value ?? 0n }),
  getTransactionReceipt: async () => ({ status: o.status ?? "success", blockNumber: 1n, logs: o.logs ?? [] }),
  getBlock: async () => ({ timestamp: BigInt(Math.floor((o.ts ?? NOW) / 1000)) }),
}) as never;

test("Arc: native or ERC-20 USDC to the agent counts once; short, failed, stale or misdirected payments do not", async () => {
  const a = { chain: "arc" as const, hash: HASH, to: AGENT, min: 47_500n, now: NOW };
  assert.deepEqual(await verifyEvmPayment(evm({ value: 50_000n * 1_000_000_000_000n }), a), { ok: true, units: 50_000n });
  const log = { address: "0x3600000000000000000000000000000000000000", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0", `0x${"0".repeat(24)}${AGENT.slice(2)}`], data: "0xc350" };
  assert.deepEqual(await verifyEvmPayment(evm({ to: "0x3600000000000000000000000000000000000000", logs: [log] }), a), { ok: true, units: 50_000n });
  assert.equal((await verifyEvmPayment(evm({ value: 1n }), a)).ok, false);
  assert.equal((await verifyEvmPayment(evm({ value: 10n ** 18n, status: "reverted" }), a)).ok, false);
  assert.equal((await verifyEvmPayment(evm({ value: 10n ** 18n, ts: NOW - 2 * 3600_000 }), a)).ok, false);
  assert.equal((await verifyEvmPayment(evm({ value: 10n ** 18n, to: "0x2222222222222222222222222222222222222222" }), a)).ok, false);
});

test("Solana: the agent wallet's SOL gain decides", async () => {
  const conn = (gain: number, blockTime = NOW / 1000) => ({
    getParsedTransaction: async () => ({
      blockTime,
      meta: { err: null, preBalances: [1_000_000, 0], postBalances: [1_000_000 - gain - 5000, gain] },
      transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => "payer" } }, { pubkey: { toBase58: () => "agent" } }] } },
    }),
  }) as never;
  const a = { sig: "5".repeat(88), to: "agent", min: 237_500n, now: NOW };
  assert.deepEqual(await verifySolanaPayment(conn(250_000), a), { ok: true, units: 250_000n });
  assert.equal((await verifySolanaPayment(conn(100_000), a)).ok, false);
  assert.equal((await verifySolanaPayment(conn(250_000, NOW / 1000 - 7200), a)).ok, false);
  assert.equal((await verifySolanaPayment(conn(250_000), { ...a, to: "someone" })).ok, false);
});

const PAY = "0x3333333333333333333333333333333333333333";
const CALL_ID = `0x${"cd".repeat(32)}`;

test("Base is offered in USDC through MimirAgentPay only when the contract is configured", () => {
  assert.equal(priceUnits("base", 0.05, P), 50_000n);
  assert.equal(PAID_TOPIC, "0x37db9851b6c9a32f8ddcf4734e6526de7c85268ef735f7883ea70dc8a39c9c85"); // cast keccak "Paid(bytes32,address,address,uint256)"
  assert.deepEqual(quote(0.05, P, { base: AGENT }).map((o) => o.chain), []);
  const [o] = quote(0.05, P, { base: AGENT }, { contract: PAY, callId: CALL_ID });
  assert.deepEqual(o, { chain: "base", asset: "USDC", amount: "0.05", units: "50000", decimals: 6, payTo: PAY, agent: AGENT, callId: CALL_ID });
  assert.match(newCallId(), /^0x[0-9a-f]{64}$/);
  assert.notEqual(newCallId(), newCallId());
  assert.equal(baseAgentPay(undefined), null);
  assert.equal(baseAgentPay("nope"), null);
  assert.equal(baseAgentPay(PAY), "0x3333333333333333333333333333333333333333");
});

const paidLog = (o: { address?: string; agent?: string; amount?: bigint; topic?: string } = {}) => ({
  address: o.address ?? PAY,
  topics: [o.topic ?? PAID_TOPIC, CALL_ID, `0x${"0".repeat(24)}${(o.agent ?? AGENT).slice(2)}`, `0x${"0".repeat(24)}${"44".repeat(20)}`],
  data: `0x${(o.amount ?? 50_000n).toString(16).padStart(64, "0")}`,
});
const baseRpc = (o: { status?: string; logs?: unknown[]; ts?: number; missing?: boolean }) => ({
  getTransactionReceipt: async () => {
    if (o.missing) throw new Error("not found");
    return { status: o.status ?? "success", blockNumber: 1n, logs: o.logs ?? [] };
  },
  getBlock: async () => ({ timestamp: BigInt(Math.floor((o.ts ?? NOW) / 1000)) }),
}) as never;

test("Base: a Paid event from MimirAgentPay to the agent counts; anything else does not", async () => {
  const a = { hash: HASH, contract: PAY, agent: AGENT.toUpperCase().replace("0X", "0x"), min: 47_500n, now: NOW };
  assert.deepEqual(await verifyBasePayment(baseRpc({ logs: [paidLog()] }), a), { ok: true, units: 50_000n });
  assert.deepEqual(await verifyBasePayment(baseRpc({ logs: [paidLog({ amount: 30_000n }), paidLog({ amount: 20_000n })] }), a), { ok: true, units: 50_000n });
  // short, from a look-alike contract, to another agent, a different event, reverted, stale, not mined yet
  assert.match(String((await verifyBasePayment(baseRpc({ logs: [paidLog({ amount: 40_000n })] }), a) as { error: string }).error), /0.04 USDC/);
  assert.equal((await verifyBasePayment(baseRpc({ logs: [paidLog({ address: "0x5555555555555555555555555555555555555555" })] }), a)).ok, false);
  assert.equal((await verifyBasePayment(baseRpc({ logs: [paidLog({ agent: "0x2222222222222222222222222222222222222222" })] }), a)).ok, false);
  assert.equal((await verifyBasePayment(baseRpc({ logs: [paidLog({ topic: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" })] }), a)).ok, false);
  assert.equal((await verifyBasePayment(baseRpc({ status: "reverted", logs: [paidLog()] }), a)).ok, false);
  assert.equal((await verifyBasePayment(baseRpc({ ts: NOW - 2 * 3600_000, logs: [paidLog()] }), a)).ok, false);
  assert.equal((await verifyBasePayment(baseRpc({ missing: true }), a)).ok, false);
});
