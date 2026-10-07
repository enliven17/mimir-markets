/**
 * Sign a fee ticket for an Arc account: its bound Solana wallet's $MIMIR
 * balance (Solana mainnet, lib/server/holder.ts) sets the tier, and the
 * signature lets contracts/MimirFees.sol apply the discount for 24 hours.
 *
 * The signer key (ARC_FEE_SIGNER_KEY) can only lower fees: a leaked key gives
 * discounts away, it moves no one's money. Tier 0 needs no ticket.
 */
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC } from "@/lib/arc/config";
import { FEE_TICKET_TYPES, feeTicketDomain, feeTierFor, TICKET_TTL_SECONDS, type FeeTicket } from "@/lib/arc/fee-tiers";
import { getArcBindingByArc } from "./arc-accounts";
import { walletBalances } from "./holder";

function signer() {
  const key = process.env.ARC_FEE_SIGNER_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as Hex);
}

export async function feeTicketFor(arcAccount: Address, now = Math.floor(Date.now() / 1000)): Promise<FeeTicket> {
  const account = getAddress(arcAccount);
  const expires = now + TICKET_TTL_SECONDS;
  const binding = await getArcBindingByArc(account);
  // Unbound accounts and unreadable balances pay the standard fee: never fail the bet over a discount.
  const mimir = binding ? await walletBalances(binding.solana).then((b) => b.mimir).catch(() => 0) : 0;
  const tier = feeTierFor(mimir);
  const fees = ARC.contracts.mimirFees;
  const key = signer();
  if (tier === 0 || !fees || !key) return { account, tier: 0, expires, signature: null };
  const signature = await key.signTypedData({
    domain: feeTicketDomain(ARC.chain.id, fees),
    types: FEE_TICKET_TYPES,
    primaryType: "FeeTicket",
    message: { account, tier, expires: BigInt(expires) },
  });
  return { account, tier, expires, signature };
}
