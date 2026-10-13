import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCESSORIES, avatarFromSeed, avatarSvg, COLOURS, faceOf, isAvatarSpec, MOODS } from "../../lib/avatar";

test("a seed always gives the same valid face", () => {
  const a = avatarFromSeed("huginn"), b = avatarFromSeed("huginn");
  assert.deepEqual(a, b);
  assert.ok(isAvatarSpec(a));
  assert.notDeepEqual(avatarFromSeed("huginn"), avatarFromSeed("muninn"));
});

test("every colour, accessory and mood draws a well-formed SVG", () => {
  for (const colour of COLOURS)
    for (const accessory of ACCESSORIES)
      for (const mood of MOODS) {
        const svg = avatarSvg({ ...avatarFromSeed("odin"), colour, accessory }, faceOf(mood), { size: 96 });
        assert.match(svg, /^<svg [^>]*viewBox="0 0 32 32"/);
        assert.ok(!svg.includes("NaN") && !svg.includes("undefined"), `${colour}/${accessory}/${mood}`);
      }
});

test("picks in the seed override the drawn traits", () => {
  const s = avatarFromSeed("freya|b:block|e:visor|c:cream");
  assert.equal(s.body, "block");
  assert.equal(s.eyes, "visor");
  assert.equal(s.colour, "cream");
});
