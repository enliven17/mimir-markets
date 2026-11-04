/** Read-only simulations; no signature or transaction is broadcast. */
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { MimirSolanaClient } from "../../lib/solana/client";
import { claimPda } from "../../lib/solana/config";
import roster from "../../config/solana-roster.json";

async function main() {
  const c = new MimirSolanaClient(Keypair.generate());
  const cfg = await c.getConfig();
  console.log(JSON.stringify({ count: cfg?.claimCount.toString(), paused: cfg?.paused, oracle: cfg?.oracle.toBase58() }));
  for (const row of await c.getClaims([35n, 51n, 73n, 74n])) {
    const p = row.claim;
    console.log(JSON.stringify({ id: Number(p.id), delegated: row.delegated, state: p.state, deadline: p.deadline, grace: p.resolutionGrace, creator: p.creator.toBase58(), creatorPaid: p.creatorPaid, paid: p.challengers.filter(x => x.paid).length, challengers: p.challengers.length }));
    if (row.delegated || p.state > 1) continue;
    const tx = await c.base.methods.refundExpired().accounts({ caller: new PublicKey(roster.creator), claim: claimPda(p.id) }).transaction();
    tx.feePayer = new PublicKey(roster.creator); tx.recentBlockhash = (await c.baseConnection.getLatestBlockhash()).blockhash;
    const sim = await c.baseConnection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    console.log(JSON.stringify({ id: Number(p.id), simulation: sim.value.err, logs: sim.value.logs?.slice(-8) }));
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Diagnostic failed"); process.exitCode = 1; });
