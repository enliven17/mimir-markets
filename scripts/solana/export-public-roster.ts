/** Export only public identities; never serialize a keypair or its secret. */
import { writeFileSync } from "node:fs";
import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { loadAgentKeypair, loadCreatorPublicKey, loadPersonaKeypair } from "../../lib/solana/keypair";

const admin = loadAgentKeypair();
const publicConfig = {
  creator: loadCreatorPublicKey().toBase58(),
  council: Object.fromEntries(COUNCIL_PERSONAS.map((persona) => [
    persona.slug, loadPersonaKeypair(admin, persona.slug).publicKey.toBase58(),
  ])),
};
if (process.argv.includes("--write")) {
  writeFileSync(new URL("../../config/solana-roster.json", import.meta.url), JSON.stringify(publicConfig, null, 2) + "\n");
  console.log(`Saved ${Object.keys(publicConfig.council).length} council public addresses. No private keys exported.`);
} else {
  console.log(JSON.stringify(publicConfig, null, 2));
}
