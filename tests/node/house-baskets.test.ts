import test from "node:test";
import assert from "node:assert/strict";

import { isValidBasketId, validateBasket } from "../../lib/baskets";
import { HOUSE_BASKETS, basketDirectory, findBasket, isHouseBasketId } from "../../lib/house-baskets";
import { COUNCIL_PERSONAS } from "../../agents/council/personas";

const slugs = new Set(COUNCIL_PERSONAS.map((p) => p.slug));

test("house baskets are valid baskets of real council personas", () => {
  assert.ok(HOUSE_BASKETS.length >= 3);
  for (const b of HOUSE_BASKETS) {
    assert.ok(isValidBasketId(b.id), b.id);
    assert.doesNotThrow(() => validateBasket(b));
    for (const m of b.members) assert.ok(slugs.has(m.agentId), `${b.id}: ${m.agentId} is not a persona`);
    assert.equal(b.house, true);
  }
});

test("house basket ids are reserved and resolve without a database", async () => {
  const first = HOUSE_BASKETS[0];
  assert.ok(isHouseBasketId(first.id));
  assert.equal(isHouseBasketId("not-a-house-basket"), false);
  assert.equal((await findBasket(first.id))?.name, first.name);
  const dir = await basketDirectory();
  assert.deepEqual(
    dir.filter((b) => b.house).map((b) => b.id),
    HOUSE_BASKETS.map((b) => b.id),
  );
});
