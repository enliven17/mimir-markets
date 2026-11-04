/** Sends one explicitly requested test-USDC payment and checks answer/replay behavior. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SOLANA_RPC, USDC_MINT } from "../../lib/solana/config";
import { assertDevnetGenesis, createDevnetConnection } from "../../lib/solana/devnet-connection";
import { CALL_MEMO_PROGRAM, callMemo } from "../../lib/solana/payment";
import { callIdFor } from "../../lib/launch/paid-call";
import roster from "../../config/solana-roster.json";

async function main() {
  const origin = process.env.MIMIR_TEST_URL || "http://localhost:3113";
  const url = new URL("/api/launch/optimist/call", origin);
  const journal = join(tmpdir(), "mimir-solana-test-call-retry.json");
  if (process.argv.includes("--resume")) {
    if (!existsSync(journal)) throw new Error("No recorded test payment to resume");
    const saved = JSON.parse(readFileSync(journal,"utf8"));
    if (saved.url !== url.toString()) throw new Error("Recorded payment belongs to another origin");
    await checkAnswer(url, saved.signature, saved.secret);
    return;
  }
  const response = await fetch(url);
  const quote = await response.json();
  if (!response.ok || quote.network !== "solana-devnet" || quote.accepts?.length !== 1) throw new Error("Native quote unavailable");
  const offer = quote.accepts[0];
  if (offer.chain !== "solana" || offer.payTo !== roster.council.optimist || callIdFor(offer.secret) !== offer.callId || BigInt(offer.units) > 50_000n) throw new Error("Quote failed pinned checks");
  if (!process.argv.includes("--send")) { console.log(JSON.stringify({ quote: "ok", network: quote.network, amount: offer.amount, sent: false })); return; }
  const keyPath = process.argv[process.argv.indexOf("--keypair") + 1];
  if (!process.argv.includes("--keypair") || !keyPath) throw new Error("--keypair <existing local file> is required with --send");
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath,"utf8"))));
  if (key.publicKey.toBase58() !== roster.creator) throw new Error("Use the devnet operator identity");
  await assertDevnetGenesis(SOLANA_RPC);
  const connection = createDevnetConnection(SOLANA_RPC), recipient = new PublicKey(offer.payTo), target = getAssociatedTokenAddressSync(USDC_MINT,recipient);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(key.publicKey,target,recipient,USDC_MINT),
    createTransferCheckedInstruction(getAssociatedTokenAddressSync(USDC_MINT,key.publicKey),USDC_MINT,target,key.publicKey,BigInt(offer.units),6),
    new TransactionInstruction({ programId: CALL_MEMO_PROGRAM, keys:[], data:Buffer.from(callMemo(offer.callId)) }),
  );
  const signature = await sendAndConfirmTransaction(connection,tx,[key],{commitment:"confirmed"});
  writeFileSync(journal,JSON.stringify({url:url.toString(),signature,secret:offer.secret}));
  console.log(JSON.stringify({payment:signature,network:"solana-devnet",testUsdc:offer.amount}));
  await checkAnswer(url, signature, offer.secret);
}
async function checkAnswer(url: URL, signature: string, secret: string) {
  const headers = {"content-type":"application/json","x-mimir-payment":`solana:${signature}:${secret}`};
  const options = {method:"POST",headers,body:JSON.stringify({prompt:"In one sentence, what evidence should an oracle require before it decides a market?"})};
  let answer = await fetch(url,options);
  if (answer.status === 502 || answer.status === 402) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    answer = await fetch(url,options);
  }
  const result = await answer.json();
  if (!answer.ok || !result.answer || result.paid?.tx !== signature) throw new Error(`Native call failed (${answer.status}): ${result.error??"invalid response"}. Payment signature was printed; inspect before paying again.`);
  const replay = await fetch(url,options);
  if (replay.status !== 409) throw new Error("Payment replay was not rejected");
  console.log(JSON.stringify({answerStatus:answer.status,answer:result.answer,replayStatus:replay.status}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Native call test failed");process.exitCode=1;});
