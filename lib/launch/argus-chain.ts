/**
 * Mimir Launch on Argus, the chain side: pin the token image, ask the Portal for the two miner inputs, mine the hook
 * salt, simulate the launch, and (with a Circle wallet) send it. Node only. See ./argus.ts for the protocol notes.
 */
import { decodeFunctionData, type Address, type Hex, type PublicClient } from "viem";

import { ARGUS, ARGUS_ABI, encodeLaunch, mineHookSalt, tokenSalt, type ArgusParams } from "./argus";

const PINATA_URL = "https://uploads.pinata.cloud/v3/files";
const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Pins a token image (data URL) to IPFS and returns `ipfs://<cid>`, the form recent Argus launches use. */
export async function pinImage(dataUrl: string, name: string, jwt = process.env.PINATA_JWT): Promise<string> {
  if (!jwt) throw new Error("PINATA_JWT is not configured");
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new Error("image must be a base64 png/jpeg/gif/webp data URL");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new Error("image must be 1 byte to 4 MB");
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new Blob([bytes], { type: m[1] }), name);
  const res = await fetch(PINATA_URL, { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`pinata upload failed: ${res.status}`);
  const cid = ((await res.json()) as { data?: { cid?: string } }).data?.cid;
  if (!cid || !/^[A-Za-z0-9]{40,100}$/.test(cid)) throw new Error("pinata returned no cid");
  return `ipfs://${cid}`;
}

export interface PreparedLaunch {
  creator: Address;
  salt: Hex;
  hookSalt: Hex;
  splitter: Address;
  hook: Address;
  token: Address;
  poolId: Hex;
  data: Hex;
  tries: number;
}

/**
 * Everything a launch needs, asked of the Portal (never rebuilt): the splitter it will clone, the hook init code hash for
 * these taxes, a mined hook salt checked with predictHook, and the token and pool it will produce.
 */
export async function prepareLaunch(client: PublicClient, creator: Address, agentUid: string, params: ArgusParams): Promise<PreparedLaunch> {
  const salt = tokenSalt(agentUid);
  const read = <T>(functionName: string, args: unknown[]) => client.readContract({ address: ARGUS.portal, abi: ARGUS_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;
  const splitter = await read<Address>("predictSplitter", [creator, salt]);
  const hash = await read<Hex>("hookInitCodeHash", [splitter, params.p.buyTaxBps, params.p.sellTaxBps, params.p.quoteAsset]);
  const { hookSalt, hook, tries } = mineHookSalt(creator, hash, salt);
  const [checked, , valid] = await read<[Address, bigint, boolean]>("predictHook", [creator, salt, hookSalt, params.p.buyTaxBps, params.p.sellTaxBps, params.p.quoteAsset]);
  if (!valid || checked.toLowerCase() !== hook.toLowerCase()) throw new Error(`mined hook ${hook} does not match the Portal's prediction ${checked}`);
  const token = await read<Address>("predictToken", [creator, salt, hook, params.p.quoteAsset]);
  const poolId = await read<Hex>("poolIdFor", [token, hook, params.p.quoteAsset]);
  return { creator, salt, hookSalt, splitter, hook, token, poolId, data: encodeLaunch(params, salt, hookSalt), tries };
}

/** Runs the launch as an eth_call from the creator (no transaction) and estimates its gas. Throws the revert if it would fail. */
export async function simulateLaunch(client: PublicClient, prep: PreparedLaunch): Promise<{ token: Address; gas: bigint; gasPrice: bigint; costWei: bigint }> {
  const { result } = await client.simulateContract({ address: ARGUS.portal, abi: ARGUS_ABI, functionName: "launch", args: decodeArgs(prep.data), account: prep.creator });
  const gas = await client.estimateGas({ account: prep.creator, to: ARGUS.portal, data: prep.data });
  const gasPrice = await client.getGasPrice();
  return { token: result as Address, gas, gasPrice, costWei: gas * gasPrice };
}

/** simulateContract takes args, not raw data: decode what encodeLaunch produced so both paths send the same bytes. */
const decodeArgs = (data: Hex) => decodeFunctionData({ abi: ARGUS_ABI, data }).args as never;
