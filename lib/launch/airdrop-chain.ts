// Mimir Launch: the chain side of holder airdrops (./airdrop.ts AirdropChain), from snipad worker/airdrop-chain.ts. Node only (web3.js).
//
// Snapshot: Helius DAS getTokenAccounts (https://www.helius.dev/docs/api-reference/das/gettokenaccounts:
// params {mint, page, limit<=1000}, result.token_accounts[{address, owner, amount}]), paged until a
// short page, over the per-process Helius client (lib/launch/solana/rpc-pool heliusClient: fails over across
// HELIUS_API_KEYS); without keys, getProgramAccounts on the mint's token program (memcmp mint at 0).
// Owners: pump.fun's bonding curve, PumpSwap/Raydium pool vaults and other escrows are program-derived
// addresses, which are off the ed25519 curve; a person's wallet is on it. So "not on curve" is excluded.
import { PublicKey, type Connection } from "@solana/web3.js";
import { agentWalletPolicy, PROGRAMS } from "./solana/policy";
import type { Privy } from "./solana/privy";
import type { Endpoints } from "./solana/submit";
import { settleSignature } from "./solana/tx";
import type { AirdropAgent, AirdropChain, HolderAccount, Transfer } from "./airdrop";

/** lib/solana/rpc-pool heliusClient: `call(key => url, init)` with failover across keys. */
type Helius = (urlFor: (key: string) => string, init?: RequestInit) => Promise<Response>;
type Conn = Pick<Connection, "getTokenSupply" | "getAccountInfo" | "getParsedProgramAccounts" | "getMultipleAccountsInfo">;
const SYSTEM = "11111111111111111111111111111111";
type PayBatch = (a: { walletId: string; wallet: string; transfers: Transfer[]; onSigned(sig: string, lastValidBlockHeight: number): Promise<void> }) => Promise<string>;

const PAGE = 1000;
const MAX_PAGES = 100;

/** `endpoints`: the sticky pool (lib/solana/rpc-pool); without it a batch's outcome is never provable (always "unknown"). */
export function createAirdropChain(d: { connection: Conn; helius?: Helius | null; executor: { payBatch: PayBatch }; privy: Pick<Privy, "walletPolicyIds" | "updatePolicy">; endpoints?: Endpoints }): AirdropChain {

  async function viaHelius(mint: string, helius: Helius): Promise<HolderAccount[]> {
    const out: HolderAccount[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await helius((key) => `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "mimir-airdrop", method: "getTokenAccounts", params: { mint, page, limit: PAGE, options: { showZeroBalance: false } } }),
      });
      if (!res.ok) throw new Error(`helius getTokenAccounts ${res.status}`);
      const j = (await res.json()) as { result?: { token_accounts?: { owner?: string; amount?: number | string }[] }; error?: { message?: string } };
      if (j.error || !j.result) throw new Error(`helius getTokenAccounts: ${j.error?.message ?? "no result"}`);
      const rows = j.result.token_accounts ?? [];
      for (const r of rows) if (r.owner && r.amount !== undefined) out.push({ owner: r.owner, amount: BigInt(r.amount) });
      if (rows.length < PAGE) return out;
    }
    throw new Error(`more than ${MAX_PAGES * PAGE} token accounts`);
  }

  async function viaRpc(mint: string): Promise<HolderAccount[]> {
    const info = await d.connection.getAccountInfo(new PublicKey(mint), "confirmed");
    const program = info?.owner ?? new PublicKey(PROGRAMS.token2022);
    const rows = await d.connection.getParsedProgramAccounts(program, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint } }] });
    return rows.flatMap((r) => {
      const parsed = (r.account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
      return parsed?.owner && parsed.tokenAmount?.amount ? [{ owner: parsed.owner, amount: BigInt(parsed.tokenAmount.amount) }] : [];
    });
  }

  async function policyId(a: AirdropAgent): Promise<string> {
    const ids = await d.privy.walletPolicyIds(a.walletId);
    if (ids.length !== 1) throw new Error(`agent wallet ${a.walletId} has ${ids.length} policies, expected 1`);
    return ids[0];
  }

  return {
    async snapshot(mint) {
      const [accounts, supply] = await Promise.all([
        d.helius ? viaHelius(mint, d.helius) : viaRpc(mint),
        d.connection.getTokenSupply(new PublicKey(mint), "confirmed"),
      ]);
      return { accounts, supply: BigInt(supply.value.amount) };
    },
    isWallet(owner) {
      try {
        return PublicKey.isOnCurve(new PublicKey(owner).toBytes());
      } catch {
        return false;
      }
    },
    curveAccount: (mint) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PROGRAMS.pump))[0].toBase58(),
    async payable(owners) {
      const out = new Set<string>();
      for (let i = 0; i < owners.length; i += 100) {
        const chunk = owners.slice(i, i + 100);
        const infos = await d.connection.getMultipleAccountsInfo(chunk.map((o) => new PublicKey(o)), "confirmed");
        chunk.forEach((o, j) => {
          const info = infos[j];
          // A missing account becomes a System account on its first transfer; anything executable or
          // owned by another program makes the whole batch fail.
          if (!info || (info.owner.toBase58() === SYSTEM && !info.executable)) out.add(o);
        });
      }
      return out;
    },
    async settle(sig, lastValidBlockHeight) {
      const ep = d.endpoints?.pickEndpoint();
      if (!ep) return "unknown";
      return (await settleSignature(ep.connection, ep.witnesses, sig, lastValidBlockHeight)).state;
    },
    async allowRecipients(a, recipients) {
      const policy = agentWalletPolicy({ wallet: a.wallet, creator: a.creator, treasury: a.treasury, ...(recipients ? { airdrop: recipients } : {}) });
      await d.privy.updatePolicy(await policyId(a), policy);
    },
    payBatch: (a) => d.executor.payBatch(a),
  };
}
