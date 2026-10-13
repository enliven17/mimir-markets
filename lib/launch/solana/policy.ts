// Privy policies for server wallets. Pure: builds the JSON body for POST /v1/policies.
//
// Docs (verified 2026-10-05):
//   https://docs.privy.io/controls/policies/overview.md            (rules, DENY wins, default DENY, every
//                                                                     Solana instruction must be ALLOWed)
//   https://docs.privy.io/controls/policies/example-policies/solana.md (programId / Transfer.to conditions,
//                                                                     ALT limitation for address conditions)
//   https://docs.privy.io/api-reference/policies/create.md         (name <= 50 chars, values are strings)
//
// Programs observed in real transactions (decoded 2026-10-05):
//   PumpPortal trade-local buy/sell (pool "pump"): ComputeBudget, ATA, PumpPortal router FAdo9N... (it CPIs
//     into pump.fun and takes PumpPortal's 0.5% fee inside the CPI).
//   PumpPortal create: ComputeBudget, pump.fun (create_v2, Token-2022 mint), ATA, PumpPortal router.
//   PumpPortal collectCreatorFee: ComputeBudget, pump.fun, ATA, pump AMM, Token (CloseAccount of WSOL).
//   Jupiter /swap/v2/build: ComputeBudget, ATA, System Transfer into the taker's WSOL ATA, Token
//     (SyncNative, CloseAccount), Jupiter v6.
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { assertAddress } from "./util";

export const PROGRAMS = {
  computeBudget: "ComputeBudget111111111111111111111111111111",
  system: "11111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  /** PumpPortal's upgradeable router (upgrade authority 83CpBne2ptvfNkWvYyvmN6izKX9sas9nH7MEu6atDFPx). */
  pumpPortalRouter: "FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe",
} as const;

/** Every top-level program a wallet may invoke (System is limited to Transfer to the allow-list). */
export const ALLOWED_PROGRAMS: readonly string[] = [
  PROGRAMS.computeBudget,
  PROGRAMS.token,
  PROGRAMS.token2022,
  PROGRAMS.associatedToken,
  PROGRAMS.jupiter,
  PROGRAMS.pump,
  PROGRAMS.pumpAmm,
  PROGRAMS.pumpPortalRouter,
];

const METHODS = ["signAndSendTransaction", "signTransaction"] as const;
type Method = (typeof METHODS)[number];

export type PolicyCondition = { field_source: string; field: string; operator: "eq" | "in"; value: string | string[] };
export type PolicyRule = { name: string; method: Method; conditions: PolicyCondition[]; action: "ALLOW" | "DENY" };
export type PolicyInput = { version: "1.0"; name: string; chain_type: "solana"; rules: PolicyRule[] };

/** The wallet's own wrapped-SOL account: Jupiter wraps SOL with a System Transfer into it. */
export function wsolAccount(wallet: string): string {
  return getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(wallet), false, TOKEN_PROGRAM_ID).toBase58();
}

function rulesFor(method: Method, recipients: string[]): PolicyRule[] {
  return [
    {
      name: "Allow trading programs",
      method,
      action: "ALLOW",
      conditions: [{ field_source: "solana_program_instruction", field: "programId", operator: "in", value: [...ALLOWED_PROGRAMS] }],
    },
    {
      name: "Allow SOL transfers to allow-list",
      method,
      action: "ALLOW",
      conditions: [
        { field_source: "solana_system_program_instruction", field: "instructionName", operator: "eq", value: "Transfer" },
        { field_source: "solana_system_program_instruction", field: "Transfer.to", operator: "in", value: recipients },
      ],
    },
    {
      // Tokens may only leave the wallet through swaps (CPI) or burns: never a direct SPL transfer,
      // and never an approval or authority change that would let someone else move them later.
      name: "Deny direct SPL token transfers and delegation",
      method,
      action: "DENY",
      conditions: [{ field_source: "solana_token_program_instruction", field: "instructionName", operator: "in", value: ["Transfer", "TransferChecked", "Approve", "ApproveChecked", "SetAuthority"] }],
    },
  ];
}

/** Privy rejects an `in` condition with more than 100 values (verified on mainnet, 2026-10-09). */
export const PRIVY_IN_MAX = 100;

/** Extra ALLOWs for one holder-airdrop round: System transfers to exactly that round's snapshot holders, one rule per 100. */
function airdropRules(method: Method, holders: string[]): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (let i = 0; i < holders.length; i += PRIVY_IN_MAX) {
    rules.push({
      name: `Allow this holder airdrop round ${i / PRIVY_IN_MAX + 1}`,
      method,
      action: "ALLOW",
      conditions: [
        { field_source: "solana_system_program_instruction", field: "instructionName", operator: "eq", value: "Transfer" },
        { field_source: "solana_system_program_instruction", field: "Transfer.to", operator: "in", value: holders.slice(i, i + PRIVY_IN_MAX) },
      ],
    });
  }
  return rules;
}

function build(name: string, wallet: string, recipients: string[], airdrop: string[] = []): PolicyInput {
  const unique = [...new Set([...recipients, wsolAccount(wallet)])];
  const holders = [...new Set(airdrop)];
  return { version: "1.0", name: name.slice(0, 50), chain_type: "solana", rules: METHODS.flatMap((m) => [...rulesFor(m, unique), ...airdropRules(m, holders)]) };
}

/**
 * Agent wallet: trade, launch, claim, burn; SOL may only go to the treasury or the agent's creator.
 * `airdrop`: while a holder airdrop round pays out, the policy is temporarily replaced by one that
 * also allows that round's recipients (worker/airdrop.ts), then restored without them.
 */
export function agentWalletPolicy(a: { wallet: string; creator: string; treasury: string; airdrop?: string[] }): PolicyInput {
  const wallet = assertAddress("wallet", a.wallet);
  const holders = (a.airdrop ?? []).map((h) => assertAddress("airdrop recipient", h));
  return build(`agent ${wallet}`, wallet, [assertAddress("treasury", a.treasury), assertAddress("creator", a.creator)], holders);
}

/** Copy-trade wallet: trade only; SOL may only go back to the follower (and the treasury if given). */
export function copyTradeWalletPolicy(a: { wallet: string; follower: string; treasury?: string }): PolicyInput {
  const wallet = assertAddress("wallet", a.wallet);
  const recipients = [assertAddress("follower", a.follower), ...(a.treasury ? [assertAddress("treasury", a.treasury)] : [])];
  return build(`copy ${wallet}`, wallet, recipients);
}
