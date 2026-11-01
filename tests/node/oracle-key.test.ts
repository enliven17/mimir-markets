import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import { oracleKey, oracleKeyFor, oracleKeyWarnings } from "../../lib/chains/house";
import { oracleRole, sameOracleAs } from "../../scripts/lib/oracle-role.mjs";

const KEY_A = `0x${"1".repeat(64)}` as const;
const KEY_B = `0x${"2".repeat(64)}` as const;
const ADDR_A = privateKeyToAccount(KEY_A).address;
const ADDR_B = privateKeyToAccount(KEY_B).address;

test("oracle key: ORACLE_KEY signs on every chain; ARC_ORACLE_KEY is its deprecated alias", () => {
  assert.equal(oracleKey({ ORACLE_KEY: KEY_A }), KEY_A);
  assert.equal(oracleKeyFor("base", { ORACLE_KEY: KEY_A }), KEY_A);
  assert.equal(oracleKeyFor("arc", { ORACLE_KEY: KEY_A }), KEY_A);
  // The alias only when ORACLE_KEY is unset.
  assert.equal(oracleKey({ ARC_ORACLE_KEY: KEY_B }), KEY_B);
  assert.equal(oracleKey({ ORACLE_KEY: KEY_A, ARC_ORACLE_KEY: KEY_B }), KEY_A);
  // No per-chain key any more: BASE_ORACLE_KEY never decides, on Base or anywhere.
  assert.equal(oracleKeyFor("base", { ORACLE_KEY: KEY_A, BASE_ORACLE_KEY: KEY_B }), KEY_A);
  assert.equal(oracleKeyFor("base", { BASE_ORACLE_KEY: KEY_B }), null);
  assert.equal(oracleKey({ ORACLE_KEY: "0x12" }), null);
  assert.equal(oracleKey({}), null);
});

test("oracle key warnings: the alias, a conflicting alias, a leftover BASE_ORACLE_KEY, a malformed key", () => {
  assert.deepEqual(oracleKeyWarnings({ ORACLE_KEY: KEY_A }), []);
  assert.match(oracleKeyWarnings({ ARC_ORACLE_KEY: KEY_A }).join(), /deprecated/);
  assert.match(oracleKeyWarnings({ ORACLE_KEY: KEY_A, ARC_ORACLE_KEY: KEY_B }).join(), /differs/);
  assert.deepEqual(oracleKeyWarnings({ ORACLE_KEY: KEY_A, ARC_ORACLE_KEY: KEY_A }), []);
  assert.match(oracleKeyWarnings({ ORACLE_KEY: KEY_A, BASE_ORACLE_KEY: KEY_B }).join(), /BASE_ORACLE_KEY/);
  assert.match(oracleKeyWarnings({ ORACLE_KEY: "nope" }).join(), /64 hex/);
});

test("deploy scripts: the oracle role is ORACLE_KEY's address on every chain", () => {
  // From the key alone, for either chain's script.
  assert.equal(oracleRole({ ORACLE_KEY: KEY_A }, "BASE_ORACLE").address, ADDR_A);
  assert.equal(oracleRole({ ORACLE_KEY: KEY_A }, "ARC_ORACLE").address, ADDR_A);
  // The shared address, or the chain's own name for it, without the key on the deploy machine.
  assert.equal(oracleRole({ ORACLE_ADDRESS: ADDR_B.toLowerCase() }, "BASE_ORACLE").address, ADDR_B);
  assert.equal(oracleRole({ ARC_ORACLE: ADDR_B }, "ARC_ORACLE").address, ADDR_B);
  // A named address that is not the key's is refused: the chains would get different oracles.
  assert.throws(() => oracleRole({ ORACLE_KEY: KEY_A, BASE_ORACLE: ADDR_B }, "BASE_ORACLE"), /same address on every chain/);
  assert.equal(oracleRole({ ORACLE_KEY: KEY_A, BASE_ORACLE: ADDR_A }, "BASE_ORACLE").address, ADDR_A);
  assert.throws(() => oracleRole({}, "BASE_ORACLE"), /oracle is required/);
  assert.match(oracleRole({ ORACLE_KEY: KEY_A, BASE_ORACLE_KEY: KEY_B }, "BASE_ORACLE").warnings.join(), /ignored/);
});

test("deploy scripts: the other chain's deployed oracle must match (or be pending)", () => {
  assert.match(sameOracleAs(ADDR_A, { oracle: ADDR_A, pending: "0x0000000000000000000000000000000000000000" }, "Arc"), /same oracle/);
  assert.match(sameOracleAs(ADDR_A, { oracle: ADDR_B, pending: ADDR_A }, "Arc"), /pending/);
  assert.match(sameOracleAs(ADDR_A, null, "Arc"), /not checked/);
  assert.throws(() => sameOracleAs(ADDR_A, { oracle: ADDR_B, pending: ADDR_B }, "Base"), /one oracle key/);
});
