/**
 * Chainlink price feeds on Ethereum mainnet: an independent, keyless price
 * source that is itself an on-chain oracle rather than an aggregator's API.
 *
 * Plain JSON-RPC `eth_call` over fetch (no EVM client library): four view
 * functions, ABI-decoded by hand. Reads go to a public mainnet RPC
 * (CHAINLINK_RPC_URL overrides). Each feed's description() is checked before
 * it is trusted, so a wrong address below fails closed instead of pricing the
 * claim off another asset.
 */
import type { PriceReading } from "../price-consensus";

/** Verified against description() on mainnet, September 2026. */
export const CHAINLINK_FEEDS: Record<string, string> = {
  BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  SOL: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  LINK: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
  AVAX: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7",
  MATIC: "0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676",
};

/** A round older than this at the target time is a stale feed, not a price. */
const MAX_ROUND_AGE_S = 26 * 3600;

const SEL = {
  description: "0x7284e416",
  decimals: "0x313ce567",
  latestRoundData: "0xfeaf968c",
  getRoundData: "0x9a6fc8f5",
} as const;

function rpcUrl(): string {
  return process.env.CHAINLINK_RPC_URL?.trim() || "https://ethereum-rpc.publicnode.com";
}

async function ethCall(to: string, data: string): Promise<string> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`eth_call HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: unknown };
  if (typeof body.result !== "string" || body.result === "0x") throw new Error("eth_call reverted");
  return body.result;
}

/** 32-byte words of an ABI-encoded return value. */
export function abiWords(hex: string): bigint[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= h.length; i += 64) out.push(BigInt(`0x${h.slice(i, i + 64)}`));
  return out;
}

/** int256 from its two's-complement word. */
export function toSigned(word: bigint): bigint {
  return word >= 1n << 255n ? word - (1n << 256n) : word;
}

/** An ABI-encoded dynamic `string` return value. */
export function abiString(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const offset = Number(BigInt(`0x${h.slice(0, 64)}`)) * 2;
  const len = Number(BigInt(`0x${h.slice(offset, offset + 64)}`));
  return Buffer.from(h.slice(offset + 64, offset + 64 + len * 2), "hex").toString("utf8");
}

interface Round {
  roundId: bigint;
  answer: bigint;
  updatedAt: number;
}

function decodeRound(hex: string): Round {
  const w = abiWords(hex);
  return { roundId: w[0], answer: toSigned(w[1]), updatedAt: Number(w[3]) };
}

/**
 * The index of the last round updated at or before `target`, given rounds
 * 1..latest ordered by time. -1 when even the first is later. Pure, so it is
 * tested without a chain.
 */
export async function lastRoundAtOrBefore(
  latest: number,
  target: number,
  updatedAtOf: (index: number) => Promise<number>,
): Promise<number> {
  let lo = 1;
  let hi = latest;
  let found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await updatedAtOf(mid);
    if (t !== 0 && t <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The feed's price for `symbol`, now or at `atMs`. A Chainlink answer stays
 * valid until the next round, so a historical reading reports the target time
 * itself as its timestamp.
 */
export async function fetchChainlinkPrice(symbol: string, atMs?: number): Promise<PriceReading | null> {
  const address = CHAINLINK_FEEDS[symbol.toUpperCase()];
  if (!address) return null;
  try {
    const [description, decimalsHex, latestHex] = await Promise.all([
      ethCall(address, SEL.description).then(abiString),
      ethCall(address, SEL.decimals),
      ethCall(address, SEL.latestRoundData),
    ]);
    if (description !== `${symbol.toUpperCase()} / USD`) return null;

    const scale = 10 ** Number(abiWords(decimalsHex)[0]);
    const target = atMs === undefined ? Math.floor(Date.now() / 1000) : Math.floor(atMs / 1000);
    let round = decodeRound(latestHex);

    if (round.updatedAt > target) {
      // Round ids are (phase << 64) | index; search this phase for the round
      // that was current at the target time.
      const phase = round.roundId >> 64n;
      const latestIndex = Number(round.roundId & ((1n << 64n) - 1n));
      const cache = new Map<number, Round>();
      const roundAt = async (index: number): Promise<Round> => {
        const hit = cache.get(index);
        if (hit) return hit;
        const id = ((phase << 64n) | BigInt(index)).toString(16).padStart(64, "0");
        const r = await ethCall(address, `${SEL.getRoundData}${id}`)
          .then(decodeRound)
          .catch(() => ({ roundId: 0n, answer: 0n, updatedAt: 0 }));
        cache.set(index, r);
        return r;
      };
      const index = await lastRoundAtOrBefore(latestIndex, target, async (i) => (await roundAt(i)).updatedAt);
      if (index < 1) return null;
      round = await roundAt(index);
    }

    if (round.answer <= 0n || target - round.updatedAt > MAX_ROUND_AGE_S) return null;
    return {
      source: "chainlink",
      priceUsd: Number(round.answer) / scale,
      at: atMs ?? round.updatedAt * 1000,
    };
  } catch {
    return null;
  }
}
