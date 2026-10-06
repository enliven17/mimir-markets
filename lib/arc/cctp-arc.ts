/**
 * The Arc side of CCTP V2 as smart-account calls (ported from
 * scripts/arc-poc/page.html). Pure: each returns `{ to, data }` for
 * `sendCalls`, which the passkey account runs as one sponsored user operation.
 */
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { ARC, FINALITY_STANDARD, type ArcConfig } from "./config";
import { ZERO_BYTES32 } from "./encoding";

export interface ArcCall {
  to: Address;
  data: Hex;
  /** Native USDC in wei (18 dp). */
  value?: bigint;
}

const receiveMessageAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const depositForBurnAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

/** Mint an attested Solana burn on Arc. Anyone may call it: the money only goes to the recipient in the message. */
export function receiveMessageCall(message: Hex, attestation: Hex, config: ArcConfig = ARC): ArcCall {
  return {
    to: config.cctp.messageTransmitterV2,
    data: encodeFunctionData({ abi: receiveMessageAbi, functionName: "receiveMessage", args: [message, attestation] }),
  };
}

/**
 * Approve + burn to Solana in one batch. `mintRecipient` is the recipient's
 * USDC token account (bytes32), not the wallet. Standard finality: no fee.
 */
export function withdrawToSolanaCalls(amount: bigint, mintRecipient: Hex, config: ArcConfig = ARC): ArcCall[] {
  if (amount <= 0n) throw new Error("amount must be positive");
  return [
    {
      to: config.usdc,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.cctp.tokenMessengerV2, amount] }),
    },
    {
      to: config.cctp.tokenMessengerV2,
      data: encodeFunctionData({
        abi: depositForBurnAbi,
        functionName: "depositForBurn",
        args: [amount, config.cctp.domains.solana, mintRecipient, config.usdc, ZERO_BYTES32, 0n, FINALITY_STANDARD],
      }),
    },
  ];
}
