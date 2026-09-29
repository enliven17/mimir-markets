import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import {
  COUNCIL_PERSONAS,
  CLASSIC_PERSONAS,
  activePersonas,
  getPersonaBySlug,
  parseTrack,
  personasForTrack,
  trackOf,
} from "../../agents/council/personas";
import { PHILOSOPHER_PERSONAS } from "../../agents/council/philosophers";
import { derivePersonaKeypair } from "../../lib/solana/keypair";

test("the roster is both juries, classic first", () => {
  assert.equal(CLASSIC_PERSONAS.length, 10);
  assert.equal(PHILOSOPHER_PERSONAS.length, 10);
  assert.equal(COUNCIL_PERSONAS.length, 20);
  assert.equal(COUNCIL_PERSONAS[0].slug, CLASSIC_PERSONAS[0].slug);
  assert.equal(COUNCIL_PERSONAS[10].slug, PHILOSOPHER_PERSONAS[0].slug);
});

test("slugs are unique across both tracks", () => {
  const slugs = COUNCIL_PERSONAS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("every persona derives its own wallet, deterministically", () => {
  const admin = Keypair.fromSeed(new Uint8Array(32).fill(7));
  const addrs = COUNCIL_PERSONAS.map((p) => derivePersonaKeypair(admin, p.slug).publicKey.toBase58());
  assert.equal(new Set(addrs).size, addrs.length, "two personas must not share a wallet");
  assert.equal(derivePersonaKeypair(admin, "socrates").publicKey.toBase58(), addrs[10]);
  // Classic wallets are unchanged by adding a track: same seed, same address.
  assert.equal(derivePersonaKeypair(admin, "optimist").publicKey.toBase58(), addrs[0]);
});

test("track filtering splits the roster exactly", () => {
  assert.equal(personasForTrack("classic").length, 10);
  assert.equal(personasForTrack("philosopher").length, 10);
  for (const p of personasForTrack("philosopher")) assert.equal(p.track, "philosopher");
  // The classic roster predates the field, so an unset track must mean classic.
  for (const p of personasForTrack("classic")) assert.equal(trackOf(p), "classic");
});

test("COUNCIL_TRACK narrows the active roster, anything else runs both", () => {
  assert.equal(parseTrack(" Philosopher "), "philosopher");
  assert.equal(parseTrack("both"), null);
  assert.equal(activePersonas({ COUNCIL_TRACK: "classic" }).length, 10);
  assert.equal(activePersonas({ COUNCIL_TRACK: "philosopher" })[0].slug, "socrates");
  assert.equal(activePersonas({}).length, 20);
});

test("every persona is resolvable by slug", () => {
  for (const p of COUNCIL_PERSONAS) {
    assert.equal(getPersonaBySlug(p.slug)?.displayName, p.displayName);
  }
  assert.equal(getPersonaBySlug("nobody"), null);
});

test("every philosopher carries the pieces the runner needs", () => {
  for (const p of PHILOSOPHER_PERSONAS) {
    assert.ok(p.promptBias && p.promptBias.length > 40, `${p.slug} needs a real prompt bias`);
    assert.match(p.promptBias!, /abstain|low confidence/i, `${p.slug} must be told when to abstain`);
    assert.ok(p.bio.length > 0 && p.longBio.length > 0, `${p.slug} needs copy for the UI`);
    assert.ok(
      p.minConfidence !== undefined && p.minConfidence >= 60 && p.minConfidence <= 95,
      `${p.slug} has an implausible confidence floor`,
    );
    assert.ok(p.stakeUsdc !== undefined && p.stakeUsdc > 0, `${p.slug} needs a stake size`);
    for (const key of ["border", "bg", "text", "chip"] as const) {
      assert.ok(p.accent[key].length > 0, `${p.slug} is missing accent.${key}`);
    }
  }
});

test("no persona invents evidence", () => {
  for (const p of COUNCIL_PERSONAS) {
    if (!p.promptBias) continue;
    assert.match(p.promptBias, /never invent/i, `${p.slug} must be told not to invent evidence`);
  }
});
