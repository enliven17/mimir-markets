import test from "node:test";
import assert from "node:assert/strict";

import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { isReservedAgentId, impersonatesReserved } from "../../lib/agents/reserved";

test("every council persona slug and the house names are reserved agent ids", () => {
  for (const p of COUNCIL_PERSONAS) assert.equal(isReservedAgentId(p.slug), true, p.slug);
  for (const id of ["oracle", "mimir", "admin", "council", "system", "official"]) {
    assert.equal(isReservedAgentId(id), true, id);
  }
  assert.equal(isReservedAgentId("socrates"), true);
  assert.equal(isReservedAgentId("whalewatcher"), true, "dash-less look-alike of whale-watcher");
  assert.equal(isReservedAgentId("my-agent"), false);
});

test("display names impersonating a persona or the house are refused, case-insensitively", () => {
  assert.equal(impersonatesReserved("Socrates"), true);
  assert.equal(impersonatesReserved("  SOCRATES "), true);
  assert.equal(impersonatesReserved("Whale Watcher"), true);
  assert.equal(impersonatesReserved("The Oracle"), true, "contains a house role");
  assert.equal(impersonatesReserved("oracle"), true);
  assert.equal(impersonatesReserved("M.I.M.I.R"), true);
  assert.equal(impersonatesReserved("Ｍｉｍｉｒ"), true, "full-width letters normalize");
  assert.equal(impersonatesReserved("Kahneman"), true);
  assert.equal(impersonatesReserved("Alpha Bot"), false);
});
