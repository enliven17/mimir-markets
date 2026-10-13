import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createAirdropChain } from "../../lib/launch/airdrop-chain";
import { agentWalletPolicy } from "../../lib/launch/solana/policy";

const MINT = Keypair.generate().publicKey.toBase58();
const wallet = () => Keypair.generate().publicKey.toBase58();
const pda = PublicKey.findProgramAddressSync([Buffer.from("pool"), new PublicKey(MINT).toBuffer()], new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"))[0].toBase58();

function fakeFetch(pages: { owner: string; amount: number }[][]) {
  const calls: unknown[] = [];
  const fetch = async (_urlFor: (k: string) => string, init?: RequestInit) => {
    if (!init) throw new Error("no body");
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const page = pages[body.params.page - 1] ?? [];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { total: page.length, limit: body.params.limit, page: body.params.page, token_accounts: page.map((p, i) => ({ address: `acc${i}`, mint: MINT, ...p })) } }));
  };
  return { fetch, calls };
}
const conn = (o: { gpa?: { owner: string; amount: string }[] } = {}) => ({
  async getTokenSupply() { return { context: { slot: 1 }, value: { amount: "1000000000000000", decimals: 6, uiAmount: 1e9 } }; },
  async getAccountInfo() { return { owner: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), data: Buffer.alloc(82), lamports: 1, executable: false, rentEpoch: 0 }; },
  async getParsedProgramAccounts() { return (o.gpa ?? []).map((g) => ({ pubkey: Keypair.generate().publicKey, account: { data: { parsed: { info: { owner: g.owner, tokenAmount: { amount: g.amount } } } } } })); },
  async getSignatureStatuses() { return { context: { slot: 1 }, value: [null] }; },
  async getBlockHeight() { return 1; },
});

test("snapshot: Helius DAS getTokenAccounts, paginated to the end; supply from the RPC", async () => {
  const a = wallet(), b = wallet();
  const full = Array.from({ length: 1000 }, () => ({ owner: a, amount: 1 }));
  const { fetch, calls } = fakeFetch([full, [{ owner: b, amount: 5 }]]);
  const chain = createAirdropChain({ connection: conn() as never, helius: fetch, executor: {} as never, privy: {} as never });
  const snap = await chain.snapshot(MINT);
  assert.equal(snap.accounts.length, 1001);
  assert.equal(snap.supply, 1_000_000_000_000_000n);
  assert.deepEqual(calls.map((c) => (c as { params: { page: number } }).params.page), [1, 2]);
  assert.equal((calls[0] as { method: string }).method, "getTokenAccounts");
});

test("snapshot without a Helius key falls back to getProgramAccounts", async () => {
  const a = wallet();
  const chain = createAirdropChain({ connection: conn({ gpa: [{ owner: a, amount: "42" }] }) as never, helius: null, executor: {} as never, privy: {} as never });
  assert.deepEqual((await chain.snapshot(MINT)).accounts, [{ owner: a, amount: 42n }]);
});

test("program-derived owners (pool vaults, curves) are not wallets; normal keys are", () => {
  const chain = createAirdropChain({ connection: conn() as never, executor: {} as never, privy: {} as never });
  assert.equal(chain.isWallet(pda), false);
  assert.equal(chain.isWallet(wallet()), true);
  assert.equal(chain.isWallet("not-an-address"), false);
  const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(MINT).toBuffer()], new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"))[0].toBase58();
  assert.equal(chain.curveAccount(MINT), curve);
});

test("allowRecipients swaps the wallet's policy for one with this round's holders, and back", async () => {
  const updates: { id: string; holders: number }[] = [];
  const privy = {
    walletPolicyIds: async () => ["pol123456789"],
    updatePolicy: async (id: string, p: ReturnType<typeof agentWalletPolicy>) => void updates.push({ id, holders: p.rules.filter((r) => r.name.startsWith("Allow this holder airdrop round")).length }),
  };
  const chain = createAirdropChain({ connection: conn() as never, executor: {} as never, privy: privy as never });
  const agent = { id: "aa", ticker: "AA", mint: MINT, walletId: "tb54eps4z44ed0jepousxi4n", wallet: wallet(), creator: wallet(), treasury: wallet(), status: "live" as const, holdersPool: 0n, holdersAirdropAt: null };
  await chain.allowRecipients(agent, [wallet(), wallet()]);
  await chain.allowRecipients(agent, null);
  assert.deepEqual(updates, [{ id: "pol123456789", holders: 2 }, { id: "pol123456789", holders: 0 }]);
});

test("M1: payable keeps missing and System-owned accounts, drops executable or program-owned ones (in chunks of 100)", async () => {
  const fresh = wallet(), plain = wallet(), program = wallet(), exec = wallet();
  const calls: number[] = [];
  const info = (owner: string, executable = false) => ({ owner: new PublicKey(owner), executable, lamports: 1, data: Buffer.alloc(0), rentEpoch: 0 });
  const c = {
    ...conn(),
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      calls.push(keys.length);
      return keys.map((k) => {
        const s = k.toBase58();
        if (s === plain) return info("11111111111111111111111111111111");
        if (s === program) return info("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        if (s === exec) return info("11111111111111111111111111111111", true);
        return null;
      });
    },
  };
  const chain = createAirdropChain({ connection: c as never, executor: {} as never, privy: {} as never });
  const many = Array.from({ length: 150 }, () => wallet());
  const ok = await chain.payable([fresh, plain, program, exec, ...many]);
  assert.deepEqual([ok.has(fresh), ok.has(plain), ok.has(program), ok.has(exec)], [true, true, false, false]);
  assert.deepEqual(calls, [100, 54]);
});

test("H1: settle uses the sticky endpoint plus a witness; with no keyed endpoint it is always unknown", async () => {
  const st = (v: unknown, h: number) => ({ getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [v] }), getBlockHeight: async () => h });
  const chain = createAirdropChain({ connection: conn() as never, executor: {} as never, privy: {} as never, endpoints: { pickEndpoint: () => ({ url: "a", connection: st(null, 1_000) as never, witnesses: [st(null, 1_000) as never] }) } });
  assert.equal(await chain.settle("sig", 100), "notLanded");
  const lagging = createAirdropChain({ connection: conn() as never, executor: {} as never, privy: {} as never, endpoints: { pickEndpoint: () => ({ url: "a", connection: st(null, 1_000) as never, witnesses: [st(null, 200) as never] }) } });
  assert.equal(await lagging.settle("sig", 100), "unknown");
  const none = createAirdropChain({ connection: conn() as never, executor: {} as never, privy: {} as never, endpoints: { pickEndpoint: () => null } });
  assert.equal(await none.settle("sig", 100), "unknown");
});
