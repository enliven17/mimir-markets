/**
 * The Clanker v4 deploy transaction for an agent's token, built by clanker-sdk (no wallet or RPC needed): the SDK
 * validates the config, encodes the hook, locker and MEV module data, and predicts the CREATE2 token address.
 */
import { Clanker } from "clanker-sdk/v4";

import { clankerTokenConfig, type ClankerLaunch } from "./clanker";
import type { DeployTx } from "./executor";

export async function clankerDeployTx(a: ClankerLaunch): Promise<DeployTx> {
  const tx = await new Clanker().getDeployTransaction(clankerTokenConfig(a));
  return { address: tx.address, abi: tx.abi as DeployTx["abi"], functionName: tx.functionName, args: tx.args as readonly unknown[], value: tx.value, expectedAddress: tx.expectedAddress };
}
