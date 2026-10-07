import assert from "node:assert/strict";
import test from "node:test";

import { datesIn, mentionsPastDay } from "../../lib/past-date";

const OCT5_NOON = Date.UTC(2026, 9, 5, 12);

test("a claim about a finished day is caught", () => {
  assert.ok(mentionsPastDay("Did Manchester City win their match against Arsenal on October 4, 2026?", OCT5_NOON));
  assert.ok(mentionsPastDay("Will X close above 5 on 3 Oct 2026?", OCT5_NOON));
  assert.ok(mentionsPastDay("Result of the 2026-10-01 race", OCT5_NOON));
  assert.ok(mentionsPastDay("Who won on Oct. 4th, 2026?", OCT5_NOON));
});

test("today counts as decided: the match can finish before the deadline", () => {
  assert.ok(mentionsPastDay("Will City beat Arsenal on October 5, 2026?", OCT5_NOON));
});

test("schedule-built drafts may name today, never yesterday", () => {
  assert.ok(!mentionsPastDay("NVDA close on October 5, 2026?", OCT5_NOON, { includeToday: false }));
  assert.ok(mentionsPastDay("NVDA close on October 4, 2026?", OCT5_NOON, { includeToday: false }));
});

test("later days and undated claims pass", () => {
  assert.ok(!mentionsPastDay("Will City beat Arsenal on October 6, 2026?", OCT5_NOON));
  assert.ok(!mentionsPastDay("Will BTC be above $120k on December 31, 2026?", OCT5_NOON));
  assert.ok(!mentionsPastDay("Will it rain in London tomorrow?", OCT5_NOON));
});

test("only full dates are read", () => {
  assert.deepEqual(datesIn("in October 2026, on May 4"), []);
  assert.equal(datesIn("between 2026-10-01 and October 9, 2026").length, 2);
});
