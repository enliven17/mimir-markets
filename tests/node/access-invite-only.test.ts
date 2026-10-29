import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_INVITE_ONLY = "1";
process.env.MIMIR_INVITE_UNLOCK_DAYS = "0";

import { accessStatus, hasAccess, mintAdminInvites, redeemInvite } from "../../lib/server/access";
import { insert, useMemoryStore } from "../../lib/server/store";

useMemoryStore();

const SOLANA = "5JZp9pA33eoUREpQS6ui6AFVdaQ147aBrjh79w252gRQ";
const EVM = "0xb05F25Bc2eb9E1f7ad3F2371Eed2DE149Bd26a40";

test("no grant, no entry", async () => {
  const s = await accessStatus(SOLANA);
  assert.equal(s.allowed, false);
  assert.equal(s.via, null);
  assert.equal(await hasAccess(SOLANA), false);
});

test("an invite code lets a Solana wallet in, and an Arc (EVM) wallet too", async () => {
  const [a, b] = await mintAdminInvites(2, "test");
  assert.equal(await redeemInvite(SOLANA, a), "ok");
  assert.equal((await accessStatus(SOLANA)).allowed, true);
  assert.equal(await redeemInvite(EVM, b), "ok");
  const s = await accessStatus(EVM);
  assert.equal(s.allowed, true);
  assert.equal(s.via, "invite");
  assert.equal(s.invites.length, 2, "a member gets its own codes");
  assert.equal(await redeemInvite(EVM, a), "already");
});

test("a wallet granted access earlier keeps its access and its codes", async () => {
  const old = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";
  await insert("access_grants", old, { wallet: old, via: "holder", code: null, granted_at: 1, checked_at: 1 }, { i1: "holder", at: 1 });
  const s = await accessStatus(old);
  assert.equal(s.allowed, true);
  assert.equal(s.via, "invite");
  assert.equal(s.invites.length, 2);
});
