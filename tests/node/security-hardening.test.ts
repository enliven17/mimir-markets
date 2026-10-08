import test from "node:test";
import assert from "node:assert/strict";

import { APP_STORE_TABLES, internalSecret, PRUNABLE_TABLES, secretMatches } from "../../lib/internal-secrets";
import { networkOf, rateKeyForIp } from "../../lib/server/rate-limit";

const S = "s".repeat(32);

test("each purpose has its own secret, falling back to the old shared one", () => {
  assert.equal(internalSecret("store", { MIMIR_INTERNAL_SECRET: S }), S);
  assert.equal(internalSecret("store", { MIMIR_STORE_SECRET: "a".repeat(32), MIMIR_INTERNAL_SECRET: S }), "a".repeat(32));
  const env = { MIMIR_STORE_SECRET: "a".repeat(32), MIMIR_EVENTS_SECRET: "b".repeat(32) };
  assert.ok(secretMatches("store", "a".repeat(32), env));
  assert.ok(!secretMatches("events", "a".repeat(32), env), "the store secret does not open events");
  assert.ok(!secretMatches("admin", "", {}), "nothing set, nothing matches");
  assert.ok(!secretMatches("store", "short", { MIMIR_STORE_SECRET: "short" }), "a short secret never matches");
});

test("only short-lived app tables can be pruned", () => {
  for (const t of PRUNABLE_TABLES) assert.ok(APP_STORE_TABLES.has(t), t);
  for (const t of ["access_grants", "arc_accounts", "agent_registry", "telegram_chats"]) assert.ok(!PRUNABLE_TABLES.has(t), t);
});

test("IPv6 is limited by its /64, IPv4 as is, mapped IPv4 as IPv4", () => {
  assert.equal(rateKeyForIp("1.2.3.4"), "1.2.3.4");
  assert.equal(rateKeyForIp("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(rateKeyForIp("2001:db8:1:2:bbbb:cccc:dddd:eeee"), "2001:db8:1:2::/64");
  assert.equal(rateKeyForIp("::ffff:9.8.7.6"), "9.8.7.6");
  assert.equal(rateKeyForIp("unknown"), "unknown");
  assert.equal(networkOf("1.2.3.4"), "1.2.3.0/24");
  assert.equal(networkOf("2001:db8:1:2::/64"), "2001:db8:1::/48");
});
