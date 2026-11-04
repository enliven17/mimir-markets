import { PublicKey } from "@solana/web3.js";

/**
 * Associated token account address (classic SPL Token program), the same PDA
 * `getAssociatedTokenAddressSync(mint, owner, true)` returns. Kept local so the
 * header and page shells do not pull @solana/spl-token into their startup
 * bundle just to derive one address.
 */
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
