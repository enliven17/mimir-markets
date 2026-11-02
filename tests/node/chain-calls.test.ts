import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, type Address, type Hex } from "viem";

import { ARC_POOL_ABI, ARC_V3_ABI, actionCall, actionCalls, approveCall, DISPUTE_BOND_WEI, ERC20_POOL_ABI, ERC20_V3_ABI, needsApproval, permitTypedData, setClaimInviteesCall, splitSignature, type MarketAction } from "../../lib/chains/calls";
import { ERC20_ABI } from "../../lib/chains/client";
import { marketChains } from "../../lib/chains/registry";
import { NoGasError, sendMarketAction } from "../../lib/chains/send";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const r = marketChains({ arc: { mimirV3: A(1), mimirPool: A(2) }, base: { mimirV3: A(3), mimirPool: A(4) } });
const base = r.chains.base;
const arc = r.chains.arc;
const USDC = 1_000_000_000_000_000_000n; // 1 USDC in index units
const ME = A(99);

const stakePool: MarketAction = { type: "stake", kind: "pool", marketId: 5, stake: 2n * USDC, side: 1 };
const stakeVs: MarketAction = { type: "stake", kind: "vs", marketId: 9, stake: 3n * USDC, side: 2 };

test("Arc: one payable call, the stake as msg.value in 18 dp", () => {
  const c = actionCall(arc, stakePool);
  assert.equal(c.to, A(2));
  assert.equal(c.value, 2n * USDC);
  assert.deepEqual(decodeFunctionData({ abi: ARC_POOL_ABI, data: c.data }).args, [5n, 1, "0x0000000000000000000000000000000000000000"]);
  assert.equal(actionCalls(arc, stakePool, 0n).length, 1, "nothing to approve on Arc");
  assert.equal(actionCall(arc, { type: "dispute", kind: "vs", marketId: 1 }).value, DISPUTE_BOND_WEI);
});

test("Base: no value, the amount in 6 dp as an argument; an exact approve unless the allowance covers it", () => {
  const c = actionCall(base, stakePool);
  assert.equal(c.value, undefined);
  assert.deepEqual(decodeFunctionData({ abi: ERC20_POOL_ABI, data: c.data }).args, [5n, 1, "0x0000000000000000000000000000000000000000", 2_000_000n]);
  const vs = actionCall(base, stakeVs);
  const d = decodeFunctionData({ abi: ERC20_V3_ABI, data: vs.data });
  assert.equal(d.functionName, "challengeClaim");
  assert.equal(d.args[1], 3_000_000n);

  const withApprove = actionCalls(base, stakeVs, 0n);
  assert.equal(withApprove.length, 2);
  assert.equal(withApprove[0].to, base.usdc.address);
  assert.deepEqual(decodeFunctionData({ abi: ERC20_ABI, data: withApprove[0].data }).args, [A(3), 3_000_000n]);
  // Allowance already there (exactly enough, or more): the call alone.
  assert.equal(actionCalls(base, stakeVs, 3n * USDC).length, 1);
  assert.equal(actionCalls(base, stakeVs, 100n * USDC).length, 1);
  assert.equal(needsApproval(base, { type: "cancel", marketId: 1 }, 0n), false, "cancel pulls nothing");
  // Dispute pulls the 2 USDC bond.
  const dispute = actionCalls(base, { type: "dispute", kind: "pool", marketId: 4 }, 0n);
  assert.deepEqual(decodeFunctionData({ abi: ERC20_ABI, data: dispute[0].data }).args, [A(4), 2_000_000n]);
});

test("Base: a create keeps its fields; sub-unit dust never reaches the chain", () => {
  const create: MarketAction = {
    type: "create",
    market: { kind: "pool", question: "Q?", labelA: "Yes", labelB: "No", resolutionUrl: "https://x", category: "crypto", deadline: 2_000_000_000, stake: USDC / 10n, side: 2 },
  };
  const d = decodeFunctionData({ abi: ERC20_POOL_ABI, data: actionCall(base, create).data });
  assert.equal(d.functionName, "createMarket");
  assert.deepEqual(d.args.slice(5), [2_000_000_000n, 2, "0x0000000000000000000000000000000000000000", 100_000n]);
  assert.throws(() => actionCall(base, { ...stakePool, stake: USDC + 1n }), /decimals/);
  assert.throws(() => approveCall(arc, A(1), USDC), /native/);
});

test("Base private VS starts closed and wallet grants need no shared key or USDC approval", () => {
  const create: MarketAction = {
    type: "create",
    market: { kind: "vs", question: "Q?", labelA: "Yes", labelB: "No", resolutionUrl: "https://x", category: "custom", deadline: 2_000_000_000, stake: USDC, isPrivate: true },
  };
  const d = decodeFunctionData({ abi: ERC20_V3_ABI, data: actionCall(base, create).data });
  assert.equal(d.functionName, "createClaim");
  assert.equal(d.args[14], true);
  assert.equal(d.args[15], "", "no invite secret goes on chain");
  for (const allowed of [true, false]) {
    const grant = setClaimInviteesCall(base, 9, [ME, A(7)], allowed);
    assert.equal(grant.to, base.contracts.mimirV3);
    assert.equal(grant.value, undefined);
    assert.deepEqual(decodeFunctionData({ abi: ERC20_V3_ABI, data: grant.data }).args, [9n, [ME, A(7)], allowed]);
  }
  assert.throws(() => actionCall(arc, create), /Base VS/);
  assert.throws(() => actionCall(base, { type: "create", market: { ...create.market, kind: "pool" } }), /Base VS/);
  assert.throws(() => setClaimInviteesCall(arc, 9, [ME], true), /Base VS/);
  assert.throws(() => setClaimInviteesCall(base, 0, [ME], true), /claim id/);
  assert.throws(() => setClaimInviteesCall(base, 1, [], true), /1 to 100/);
  assert.throws(() => setClaimInviteesCall(base, 1, Array(101).fill(ME), true), /1 to 100/);
  assert.throws(() => setClaimInviteesCall(base, 1, [A(0)], true), /wallet/);
});

test("Base: the permit variants carry the signature; VS never takes one", () => {
  const permit = { deadline: 123n, v: 27, r: `0x${"a".repeat(64)}` as Hex, s: `0x${"b".repeat(64)}` as Hex };
  const d = decodeFunctionData({ abi: ERC20_POOL_ABI, data: actionCall(base, stakePool, permit).data });
  assert.equal(d.functionName, "stakeWithPermit");
  assert.deepEqual(d.args.slice(3), [2_000_000n, 123n, 27, permit.r, permit.s]);
  assert.equal(decodeFunctionData({ abi: ERC20_POOL_ABI, data: actionCall(base, { type: "dispute", kind: "pool", marketId: 2 }, permit).data }).functionName, "disputeWithPermit");
  assert.throws(() => actionCall(base, stakeVs, permit), /permit/);
  assert.throws(() => actionCall(arc, stakePool, permit), /permit/);
  const typed = permitTypedData(base, { owner: ME, spender: A(4), valueWei: 2n * USDC, nonce: 7n, deadline: 123n, tokenName: "USDC", tokenVersion: "2" });
  assert.equal(typed.domain.chainId, 84532);
  assert.equal(typed.domain.verifyingContract, base.usdc.address);
  assert.equal(typed.message.value, 2_000_000n);
  assert.deepEqual(splitSignature(`0x${"1".repeat(64)}${"2".repeat(64)}00`), { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 });
});

/** A fake wallet: records what it sends and signs. */
function fakeWallet(opts: { signFails?: Error } = {}) {
  const sent: Array<Array<{ to: Address; data: Hex; value?: bigint }>> = [];
  let signed = 0;
  return {
    sent,
    signedCount: () => signed,
    session: {
      address: ME,
      sendCalls: async (calls: Array<{ to: Address; data: Hex; value?: bigint }>) => {
        sent.push(calls);
        return { txHash: "0x01" as Hex, txHashes: calls.map(() => "0x01" as Hex) };
      },
    },
    signTypedData: async () => {
      signed++;
      if (opts.signFails) throw opts.signFails;
      return `0x${"1".repeat(64)}${"2".repeat(64)}1b` as Hex;
    },
  };
}
const permitInfo = async () => ({ nonce: 0n, name: "USDC", version: "2" });

test("send on Base: allowance covers it → one call, no signature", async () => {
  const w = fakeWallet();
  const r1 = await sendMarketAction(base, w.session, stakePool, { allowance: async () => 5n * USDC, permitInfo, signTypedData: w.signTypedData });
  assert.equal(r1.path, "allowance");
  assert.equal(w.sent[0].length, 1);
  assert.equal(w.signedCount(), 0);
});

test("send on Base: a pool stake signs a permit and sends ONE transaction", async () => {
  const w = fakeWallet();
  const r1 = await sendMarketAction(base, w.session, stakePool, { allowance: async () => 0n, permitInfo, signTypedData: w.signTypedData, now: () => 1000 });
  assert.equal(r1.path, "permit");
  assert.equal(w.sent[0].length, 1);
  const d = decodeFunctionData({ abi: ERC20_POOL_ABI, data: w.sent[0][0].data });
  assert.equal(d.functionName, "stakeWithPermit");
  assert.equal(d.args[4], 1000n + 1800n, "permit deadline");
});

test("send on Base: no typed-data signing → approve + call; the user saying no stops everything", async () => {
  const w = fakeWallet({ signFails: new Error("eth_signTypedData_v4 not supported") });
  const r1 = await sendMarketAction(base, w.session, stakePool, { allowance: async () => 0n, permitInfo, signTypedData: w.signTypedData });
  assert.equal(r1.path, "approve");
  assert.equal(w.sent[0].length, 2);
  assert.equal(decodeFunctionData({ abi: ERC20_ABI, data: w.sent[0][0].data }).functionName, "approve");

  const no = fakeWallet({ signFails: Object.assign(new Error("User rejected the request."), { code: 4001 }) });
  await assert.rejects(sendMarketAction(base, no.session, stakePool, { allowance: async () => 0n, permitInfo, signTypedData: no.signTypedData }), /rejected/);
  assert.equal(no.sent.length, 0);
});

test("send on Base: VS approves then calls; no ETH stops before the wallet opens; Arc is one plain tx", async () => {
  const w = fakeWallet();
  const r1 = await sendMarketAction(base, w.session, stakeVs, { allowance: async () => 0n, permitInfo, signTypedData: w.signTypedData });
  assert.equal(r1.path, "approve");
  assert.equal(w.signedCount(), 0, "VS has no permit variant");
  assert.equal(w.sent[0].length, 2);

  const broke = fakeWallet();
  await assert.rejects(sendMarketAction(base, broke.session, stakePool, { allowance: async () => 0n, gasBalance: async () => 0n }), NoGasError);
  assert.equal(broke.sent.length, 0);

  const a = fakeWallet();
  const r2 = await sendMarketAction(arc, a.session, stakePool, { allowance: async () => 0n });
  assert.equal(r2.path, "native");
  assert.equal(a.sent[0][0].value, 2n * USDC);
  assert.equal(decodeFunctionData({ abi: ARC_V3_ABI, data: actionCall(arc, stakeVs).data }).functionName, "challengeClaim");
});
