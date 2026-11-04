import "server-only";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MimirSolanaClient } from "../solana/client";
import { USDC_MINT, MIMIR_PROGRAM_ID, ER_VALIDATOR, SOLANA_RPC, MAGICBLOCK_ER_RPC, claimPda, balancePda } from "../solana/config";
import { assertDevnetGenesis } from "../solana/devnet-connection";
import { AgentEnvelopeError } from "./api";
import type { WriteParams } from "./params";

let reader: MimirSolanaClient | undefined;
const read = () => reader ??= new MimirSolanaClient(Keypair.generate());
const bn = (n: bigint | number) => new BN(n.toString());
const ata = (p: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, p, true);
export interface NativePreparedTx {
  layer: "base" | "er"; rpcUrl: string; transaction: string; description: string;
  recentBlockhash: string; lastValidBlockHeight: number; genesisHash: string;
}
function fail(message: string): never { throw new AgentEnvelopeError(message, 409, "native_state"); }
async function prepare(layer: "base" | "er", payer: PublicKey, ix: TransactionInstruction, description: string): Promise<NativePreparedTx> {
  await assertDevnetGenesis(SOLANA_RPC);
  const connection = layer === "base" ? read().baseConnection : read().erConnection;
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, ...block }).add(ix);
  return { layer, rpcUrl: layer === "base" ? "https://api.devnet.solana.com" : MAGICBLOCK_ER_RPC,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), description,
    recentBlockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight,
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };
}
export async function prepareNative(write: WriteParams, body: Record<string, unknown>, operator: string) {
  if (body.chain !== undefined && body.chain !== "solana") throw new AgentEnvelopeError("Solana devnet only", 400, "bad_chain");
  if (body.kind !== undefined && body.kind !== "vs") throw new AgentEnvelopeError("This program supports public VS markets", 400, "bad_kind");
  const r = read(), user = new PublicKey(operator), cfg = await r.getConfig();
  if (!cfg || !cfg.usdcMint.equals(USDC_MINT)) throw new AgentEnvelopeError("Program config unavailable", 503, "chain_unavailable");
  const transactions: NativePreparedTx[] = [];
  let claimId: string | undefined;
  if (write.action === "createClaim") {
    if (cfg.paused) fail("The program is paused");
    const p = write.params, next = cfg.claimCount + 1n;
    const ix = await r.base.methods.createClaim({ question: p.question, creatorPosition: p.creatorPosition, counterPosition: p.counterPosition, resolutionUrl: p.resolutionUrl,
      category: p.category, deadline: bn(p.deadline), stakeAmount: bn(p.stakeUnits), maxChallengers: p.maxChallengers, agent: null })
      .accounts({ creator: user, claim: claimPda(next), creatorToken: ata(user) }).instruction();
    transactions.push(await prepare("base", user, ix, "Open and fund a public VS claim on Solana Devnet")); claimId = next.toString();
  } else if (write.action === "challenge") {
    if (cfg.paused) fail("The program is paused");
    const p = write.params, c = await r.getClaim(p.claimId);
    if (!c || c.state > 1 || c.deadline - 60 <= Math.floor(Date.now() / 1000)) fail("The claim is closed");
    if (c.creator.equals(user) || c.challengers.some(p => p.addr.equals(user))) fail("This wallet already has a position");
    if (p.stakeUnits < 2_000_000n || c.totalChallengerStake + p.stakeUnits > c.creatorStake * 5n || c.challengers.length >= (c.maxChallengers || 16)) fail("The stake exceeds this claim's limits");
    const inEr = await r.isDelegated(p.claimId), balanceInEr = await r.isBalanceDelegated(user), free = await r.getBalance(user);
    let delegated = balanceInEr;
    if (delegated && (free < p.stakeUnits || !inEr)) {
      transactions.push(await prepare("er", user, await r.er.methods.undelegateBalance().accounts({ payer: user, balance: balancePda(user) }).instruction(), "Return free balance to the base layer; wait for undelegation")); delegated = false;
    }
    if (free < p.stakeUnits) transactions.push(await prepare("base", user, await r.base.methods.deposit(bn(p.stakeUnits - free)).accounts({ user, userToken: ata(user) }).instruction(), "Deposit only the missing test USDC into the program"));
    if (inEr && !delegated) transactions.push(await prepare("base", user, await r.base.methods.delegateBalance().accounts({ payer: user, balance: balancePda(user) }).remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }]).instruction(), "Delegate the balance; wait for the rollup account"));
    const layer = inEr ? "er" : "base", program = inEr ? r.er : r.base;
    transactions.push(await prepare(layer, user, await program.methods.challengeClaim(bn(p.stakeUnits), null).accounts({ challenger: user, claim: claimPda(p.claimId), balance: balancePda(user) }).instruction(), "Stake on the counter position"));
  } else if (write.action === "dispute") {
    const c = await r.getBaseClaim(write.params.claimId);
    if (!c || c.state !== 4 || c.disputableUntil <= Math.floor(Date.now() / 1000)) fail("There is no disputable proposal");
    if (!c.creator.equals(user) && !c.challengers.some(p => p.addr.equals(user))) fail("Only a participant can dispute");
    transactions.push(await prepare("base", user, await r.base.methods.disputeResolution().accounts({ disputer: user, claim: claimPda(c.id), disputerToken: ata(user) }).instruction(), "Post a 2 test USDC dispute bond"));
  } else if (write.action === "withdraw") {
    if (await r.isBalanceDelegated(user)) transactions.push(await prepare("er", user, await r.er.methods.undelegateBalance().accounts({ payer: user, balance: balancePda(user) }).instruction(), "Return free balance from the rollup; wait for undelegation"));
    if (write.params.amountUnits > await r.getBalance(user)) fail("Not enough free program balance");
    transactions.push(await prepare("base", user, await r.base.methods.withdraw(bn(write.params.amountUnits)).accounts({ user, owner: user, userToken: ata(user) }).instruction(), "Withdraw free test USDC to the operator's own wallet"));
  }
  return { chain: "solana" as const, programId: MIMIR_PROGRAM_ID.toBase58(), transactions, ...(claimId ? { claimId } : {}) };
}
