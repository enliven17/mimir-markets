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
