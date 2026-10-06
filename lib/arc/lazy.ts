"use client";

/**
 * Code-split front door to the Arc wallet layer (same pattern as
 * lib/solana/browser-client-lazy.ts). The Circle SDK, viem's account
 * abstraction, Anchor and the two CCTP IDLs load the first time the wallet
 * page needs them, never on a plain page view elsewhere.
 */
import type * as Account from "./account";
import type * as Transfers from "./transfers";
import type * as SolanaSide from "./cctp-solana";

let account: Promise<typeof Account> | null = null;
let transfers: Promise<typeof Transfers> | null = null;
let solana: Promise<typeof SolanaSide> | null = null;

export const loadArcAccount = () => (account ??= import("./account"));
export const loadArcTransfers = () => (transfers ??= import("./transfers"));
export const loadArcSolana = () => (solana ??= import("./cctp-solana"));
