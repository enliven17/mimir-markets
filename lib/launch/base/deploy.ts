/**
 * The Clanker v4 deploy transaction for an agent's token, built by clanker-sdk (no wallet or RPC needed): the SDK
 * validates the config, encodes the hook, locker and MEV module data, and predicts the CREATE2 token address. The
 * owner's wallet sends it.
 */
import { Clanker } from "clanker-sdk/v4";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";

import { clankerTokenConfig, type ClankerLaunch } from "./clanker";

export interface DeployTx {
  to: Address;
  data: Hex;
  value: bigint;
  expectedAddress: Address | null;
}

export async function clankerDeployTx(a: ClankerLaunch): Promise<DeployTx> {
  const tx = await new Clanker().getDeployTransaction(clankerTokenConfig(a));
  const data = encodeFunctionData({ abi: tx.abi as Abi, functionName: tx.functionName, args: tx.args as readonly unknown[] });
  return { to: tx.address, data, value: tx.value ?? 0n, expectedAddress: (tx.expectedAddress as Address | undefined) ?? null };
}
