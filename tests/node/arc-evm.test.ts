import assert from "node:assert/strict";
import test from "node:test";

import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ARC_USDC } from "../../lib/arc/config";
import {
  arcEvmBindMessage,
  checkArcEvmBindBody,
  EVM_PROOF_HEADER,
  EVM_WALLET_HEADER,
  evmProofMessage,
  fundedSession,
  isFreshArcEvmBind,
  NotEnoughUsdcError,
  parseEvmProofHeader,
  sendBackCall,
  unitsForWei,
  walletSpendableUnits,
  WEI_PER_UNIT,
  withWalletFunding,
} from "../../lib/arc/evm";
import type { ArcCall } from "../../lib/arc/cctp-arc";
import { ArcRebindTooSoonError, REBIND_COOLDOWN_MS } from "../../lib/server/arc-accounts";
import { ArcEvmAccountTakenError, getArcEvmBinding, getArcEvmBindingByArc, upsertArcEvmBinding } from "../../lib/server/arc-evm-accounts";
import { provenEvmWallet, provenIdentity } from "../../lib/server/wallet-proof";
import { useMemoryStore } from "../../lib/server/store";

useMemoryStore();

const WALLET = "0xb05F25Bc2eb9E1f7ad3F2371Eed2DE149Bd26a40" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const ACCOUNT_2 = "0x3333333333333333333333333333333333333333" as Address;
const SIG = `0x${"ab".repeat(65)}`;
const usdc = (n: bigint) => n * 1_000_000n;
const stake = (wei: bigint): ArcCall => ({ to: OTHER, data: "0x1234", value: wei });

test("bind message names both addresses and the time; a stale or future signedAt is refused", () => {
  const now = 1_800_000_000_000;
  const m = arcEvmBindMessage(WALLET, ACCOUNT, now);
  assert.match(m, new RegExp(`wallet: ${WALLET}`));
  assert.match(m, new RegExp(`arc: ${ACCOUNT}`));
  assert.match(m, /It moves no funds/);
  assert.equal(isFreshArcEvmBind(now - 4 * 60_000, now), true);
  assert.equal(isFreshArcEvmBind(now - 6 * 60_000, now), false);
  assert.equal(isFreshArcEvmBind(now + 2 * 60_000, now), false);
});

test("checkArcEvmBindBody: checksums, rejects the account binding itself and bad signatures", () => {
  const now = Date.now();
  const ok = checkArcEvmBindBody({ evm: WALLET.toLowerCase(), arc: ACCOUNT, signedAt: now, evmSignature: SIG, arcSignature: SIG }, now);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.request.evm, WALLET);
    assert.equal(ok.message, arcEvmBindMessage(WALLET, ACCOUNT, now));
  }
  assert.equal(checkArcEvmBindBody({ evm: ACCOUNT, arc: ACCOUNT, signedAt: now, evmSignature: SIG, arcSignature: SIG }, now).ok, false);
  assert.equal(checkArcEvmBindBody({ evm: WALLET, arc: ACCOUNT, signedAt: now, evmSignature: "0x12", arcSignature: SIG }, now).ok, false);
  const stale = checkArcEvmBindBody({ evm: WALLET, arc: ACCOUNT, signedAt: now - 10 * 60_000, evmSignature: SIG, arcSignature: SIG }, now);
  assert.equal(stale.ok === false && stale.status, 401);
});

test("allowance math: units round up from wei; what is spendable is the smaller of cap and wallet", () => {
  assert.equal(unitsForWei(0n), 0n);
  assert.equal(unitsForWei(1n), 1n);
  assert.equal(unitsForWei(WEI_PER_UNIT), 1n);
  assert.equal(unitsForWei(WEI_PER_UNIT + 1n), 2n);
  assert.equal(walletSpendableUnits(usdc(100n), usdc(30n)), usdc(30n));
  assert.equal(walletSpendableUnits(usdc(10n), usdc(30n)), usdc(10n));
});

test("withWalletFunding: unchanged when the account covers it; else a transferFrom of the shortfall goes first", () => {
  const f = { wallet: WALLET, account: ACCOUNT, accountWei: usdc(2n) * WEI_PER_UNIT, allowanceUnits: usdc(100n), walletUnits: usdc(50n) };
  const calls = [stake(usdc(2n) * WEI_PER_UNIT)];
  assert.deepEqual(withWalletFunding(calls, f), calls);

  const big = [stake(usdc(5n) * WEI_PER_UNIT + 1n)];
  const out = withWalletFunding(big, f);
  assert.equal(out.length, 2);
  assert.equal(out[0].to, ARC_USDC);
  assert.equal(out[0].value, 0n);
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: out[0].data });
  assert.equal(functionName, "transferFrom");
  assert.deepEqual(args, [WALLET, ACCOUNT, usdc(3n) + 1n]);
  assert.deepEqual(out[1], big[0]);
});

test("withWalletFunding: refuses when the cap or the wallet falls short", () => {
  const base = { wallet: WALLET, account: ACCOUNT, accountWei: 0n };
  const calls = [stake(usdc(20n) * WEI_PER_UNIT)];
  assert.throws(() => withWalletFunding(calls, { ...base, allowanceUnits: usdc(5n), walletUnits: usdc(100n) }), (e) => e instanceof NotEnoughUsdcError && e.shortUnits === usdc(15n));
  assert.throws(() => withWalletFunding(calls, { ...base, allowanceUnits: usdc(100n), walletUnits: usdc(1n) }), NotEnoughUsdcError);
});

test("fundedSession tops up on send, reads nothing for value-free calls, and sends back as a plain transfer", async () => {
  const sent: ArcCall[][] = [];
  let reads = 0;
  const session = { address: ACCOUNT, sendCalls: async (c: ArcCall[]) => void sent.push(c) };
  const s = fundedSession(session, WALLET, async () => {
    reads++;
    return { accountWei: 0n, allowanceUnits: usdc(10n), walletUnits: usdc(10n) };
  });
  await s.sendCalls([{ to: OTHER, data: "0x", value: 0n }]);
  assert.equal(reads, 0);
  await s.sendCalls([stake(usdc(1n) * WEI_PER_UNIT)]);
  assert.equal(reads, 1);
  assert.equal(sent[1].length, 2);
  assert.deepEqual(sendBackCall(WALLET, 5n), { to: WALLET, data: "0x", value: 5n });
});

test("EVM binding: one account per wallet, a taken account is refused, a switch waits out the cooldown", async () => {
  const t0 = 1_800_000_000_000;
  await upsertArcEvmBinding({ evm: WALLET, arc: ACCOUNT, credentialId: null, now: t0 });
  assert.equal((await getArcEvmBinding(WALLET))?.arc, ACCOUNT);
  assert.equal((await getArcEvmBindingByArc(ACCOUNT))?.evm, WALLET);
  // Same pair again: fine (idempotent).
  await upsertArcEvmBinding({ evm: WALLET, arc: ACCOUNT, credentialId: null, now: t0 + 1 });
  await assert.rejects(upsertArcEvmBinding({ evm: OTHER, arc: ACCOUNT, credentialId: null, now: t0 + 2 }), ArcEvmAccountTakenError);
  await assert.rejects(upsertArcEvmBinding({ evm: WALLET, arc: ACCOUNT_2, credentialId: null, now: t0 + 3 }), ArcRebindTooSoonError);
  await upsertArcEvmBinding({ evm: WALLET, arc: ACCOUNT_2, credentialId: null, now: t0 + 1 + REBIND_COOLDOWN_MS });
  assert.equal(await getArcEvmBindingByArc(ACCOUNT), null);
  assert.equal((await getArcEvmBindingByArc(ACCOUNT_2))?.evm, WALLET);
});

test("provenEvmWallet: a wallet-signed proof header proves the address; a wrong or stale one does not", async () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const signedAt = Date.now();
  const signature = await key.signMessage({ message: evmProofMessage(key.address, signedAt) });
  const req = (wallet: string, proof: string) => new Request("http://x/api/arc/evm-bind", { headers: { [EVM_WALLET_HEADER]: wallet, [EVM_PROOF_HEADER]: proof } });
  assert.equal(await provenEvmWallet(req(key.address.toLowerCase(), `${signedAt}.${signature}`)), key.address);
  assert.equal(await provenIdentity(req(key.address, `${signedAt}.${signature}`)), key.address);
  assert.equal(parseEvmProofHeader(`${signedAt - 25 * 3_600_000}.${signature}`), null);
  // Signed by someone else: recovers to another address, and the ERC-1271 fallback finds no contract there (or no RPC).
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = await other.signMessage({ message: evmProofMessage(key.address, signedAt) });
  assert.equal(await provenEvmWallet(req(key.address, `${signedAt}.${forged}`)), null);
});
