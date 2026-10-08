import assert from "node:assert/strict";
import test from "node:test";

import { accessMinMimir, INVITE_PATTERN, inviteOnly, invitesPerUser, normalizeInvite } from "../../lib/access";

test("invite-only is on for mainnet, off for testnet, and the flag overrides both", () => {
  assert.equal(inviteOnly("mainnet", undefined), true);
  assert.equal(inviteOnly("testnet", undefined), false);
  assert.equal(inviteOnly("testnet", "1"), true);
  assert.equal(inviteOnly("mainnet", "0"), false);
});

test("codes normalize case and spaces, and refuse look-alike characters", () => {
  assert.equal(normalizeInvite(" mimir-ab2c-9xyz "), "MIMIR-AB2C-9XYZ");
  assert.equal(normalizeInvite("MIMIR-AB0C-9XYZ"), null);
  assert.equal(normalizeInvite("MIMIR-ABCD"), null);
  assert.ok(INVITE_PATTERN.test("MIMIR-HJKL-2345"));
});

test("the holder minimum defaults to 5M and can move by env", () => {
  assert.equal(accessMinMimir({}), 5_000_000);
  assert.equal(accessMinMimir({ MIMIR_ACCESS_MIN: "1000000" }), 1_000_000);
});

test("codes per member default to 2 and follow MIMIR_INVITES_PER_USER", () => {
  assert.equal(invitesPerUser({}), 2);
  assert.equal(invitesPerUser({ MIMIR_INVITES_PER_USER: "3" }), 3);
  assert.equal(invitesPerUser({ MIMIR_INVITES_PER_USER: "-1" }), 2);
});

test("codes wait for the grant to age, and a holder must still hold to get them", async () => {
  const { inviteMintAllowance } = await import("../../lib/access");
  const day = 86_400_000;
  const base = { via: "holder" as const, grantedAt: 0, holdsMinimum: true, existing: 0, allowance: 2, unlockMs: 3 * day };
  assert.equal(inviteMintAllowance({ ...base, now: day }), 0, "too new");
  assert.equal(inviteMintAllowance({ ...base, now: 4 * day }), 2);
  assert.equal(inviteMintAllowance({ ...base, now: 4 * day, holdsMinimum: false }), 0, "moved the tokens away");
  assert.equal(inviteMintAllowance({ ...base, via: "invite", now: 4 * day, holdsMinimum: false }), 2, "invitees need no $MIMIR");
  assert.equal(inviteMintAllowance({ ...base, now: 4 * day, existing: 1 }), 1);
  assert.equal(inviteMintAllowance({ ...base, now: 4 * day, existing: 3 }), 0);
});
