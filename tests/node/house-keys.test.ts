/**
 * Key separation (audit P0-1): persona keys from COUNCIL_KEY_SEED, never the
 * admin secret on mainnet; the creator never falls back to (or equals) the
 * admin key on mainnet; script guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";

import {
  councilKeySeed,
  derivePersonaKeypair,
  loadCreatorKeypair,
  loadCreatorPublicKey,
} from "../../lib/solana/keypair";
import { devnetOnlyProblem, initKeysProblem, mainnetConfirmProblem, positional } from "../../scripts/solana/guards";

const KEYS = ["SOLANA_KEYPAIR_JSON", "CREATOR_KEYPAIR_JSON", "CREATOR_KEYPAIR", "CREATOR_PUBKEY", "COUNCIL_KEY_SEED"] as const;

function withEnv(vars: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void): void {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const secretJson = (kp: Keypair) => JSON.stringify(Array.from(kp.secretKey));
const SEED_HEX = "ab".repeat(32);

test("COUNCIL_KEY_SEED parses hex or base64 and needs 32 bytes", () => {
  assert.equal(councilKeySeed(undefined), null);
  assert.equal(councilKeySeed("  "), null);
  assert.equal(councilKeySeed(SEED_HEX)!.length, 32);
  assert.equal(councilKeySeed(Buffer.alloc(48, 7).toString("base64"))!.length, 48);
  assert.throws(() => councilKeySeed("abcd"), /32 bytes/);
});

test("persona keys derive from the seed, independent of the admin key", () => {
  const seed = councilKeySeed(SEED_HEX)!;
  const a = derivePersonaKeypair(Keypair.generate(), "socrates", { seed, mainnet: true });
  const b = derivePersonaKeypair(Keypair.generate(), "socrates", { seed, mainnet: true });
  assert.equal(a.publicKey.toBase58(), b.publicKey.toBase58(), "oracle and council processes agree on the address");
  assert.notEqual(a.publicKey.toBase58(), derivePersonaKeypair(Keypair.generate(), "taleb", { seed }).publicKey.toBase58());
});

test("on mainnet a missing seed throws; off mainnet the admin derivation stays", () => {
  const admin = Keypair.generate();
  assert.throws(() => derivePersonaKeypair(admin, "socrates", { seed: null, mainnet: true }), /COUNCIL_KEY_SEED/);
  const legacy = derivePersonaKeypair(admin, "socrates", { seed: null, mainnet: false });
  assert.equal(legacy.publicKey.toBase58(), derivePersonaKeypair(admin, "socrates", { seed: null, mainnet: false }).publicKey.toBase58());
  // The env seed wins over the admin secret when set, on any cluster.
  withEnv({ COUNCIL_KEY_SEED: SEED_HEX }, () => {
    const seeded = derivePersonaKeypair(admin, "socrates", { mainnet: false });
    assert.notEqual(seeded.publicKey.toBase58(), legacy.publicKey.toBase58());
    assert.equal(seeded.publicKey.toBase58(), derivePersonaKeypair(Keypair.generate(), "socrates", { mainnet: true }).publicKey.toBase58());
  });
});

test("the creator never falls back to the admin key on mainnet", () => {
  const admin = Keypair.generate();
  const creator = Keypair.generate();
  withEnv({ SOLANA_KEYPAIR_JSON: secretJson(admin) }, () => {
    assert.equal(loadCreatorKeypair({ mainnet: false }).publicKey.toBase58(), admin.publicKey.toBase58(), "devnet fallback kept");
    assert.throws(() => loadCreatorKeypair({ mainnet: true }), /CREATOR_KEYPAIR_JSON/);
  });
  withEnv({ SOLANA_KEYPAIR_JSON: secretJson(admin), CREATOR_KEYPAIR_JSON: secretJson(admin) }, () => {
    assert.throws(() => loadCreatorKeypair({ mainnet: true }), /must differ/);
  });
  withEnv({ SOLANA_KEYPAIR_JSON: secretJson(admin), CREATOR_KEYPAIR_JSON: secretJson(creator) }, () => {
    assert.equal(loadCreatorKeypair({ mainnet: true }).publicKey.toBase58(), creator.publicKey.toBase58());
  });
  withEnv({ CREATOR_PUBKEY: creator.publicKey.toBase58() }, () => {
    assert.equal(loadCreatorPublicKey({ mainnet: true }).toBase58(), creator.publicKey.toBase58(), "pubkey only, no secret needed");
  });
});

test("devnet tooling refuses mainnet without --mainnet; admin writes need --yes", () => {
  assert.equal(devnetOnlyProblem("smoke-v3", { mainnet: false, argv: [] }), null);
  assert.match(devnetOnlyProblem("smoke-v3", { mainnet: true, argv: [] })!, /--mainnet/);
  assert.equal(devnetOnlyProblem("smoke-v3", { mainnet: true, argv: ["--mainnet"] }), null);
  assert.equal(mainnetConfirmProblem("admin pause", { mainnet: false, argv: [] }), null);
  assert.match(mainnetConfirmProblem("admin pause", { mainnet: true, argv: ["pause"] })!, /--yes/);
  assert.equal(mainnetConfirmProblem("admin pause", { mainnet: true, argv: ["pause", "--yes"] }), null);
  assert.deepEqual(positional(["propose-admin", "--yes", "Abc"]), ["propose-admin", "Abc"]);
});

test("initialize on mainnet needs a separate oracle and fee recipient", () => {
  const admin = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const cold = Keypair.generate().publicKey.toBase58();
  const p = (oracle: string | undefined, feeRecipient: string | undefined, mainnet = true) =>
    initKeysProblem({ mainnet, admin, oracle, feeRecipient });
  assert.equal(p(undefined, undefined, false), null, "devnet keeps the admin defaults");
  assert.match(p(undefined, cold)!, /MIMIR_ORACLE must be set/);
  assert.match(p(other, " ")!, /MIMIR_FEE_RECIPIENT must be set/);
  assert.match(p(admin, cold)!, /MIMIR_ORACLE must differ/);
  assert.match(p(other, admin)!, /MIMIR_FEE_RECIPIENT must differ/);
  assert.equal(p(other, cold), null);
});
