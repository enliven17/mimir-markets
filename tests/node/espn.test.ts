import assert from "node:assert/strict";
import { test } from "node:test";

import { espnResultText, espnSummaryUrl, parseEspnSummary } from "../../lib/espn";

test("ESPN game links map to the event summary; anything else does not", () => {
  assert.equal(
    espnSummaryUrl("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261013&event=401872994"),
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872994",
  );
  assert.equal(
    espnSummaryUrl("https://www.espn.com/soccer/match/_/gameId/401915435/barcelona-galatasaray"),
    "https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401915435",
  );
  assert.equal(espnSummaryUrl("https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261013"), null);
  assert.equal(espnSummaryUrl("https://evil.example/apis/site/v2/sports/football/nfl/summary?event=1234"), null);
  assert.equal(espnSummaryUrl("not a url"), null);
});

test("a summary payload gives completion, score, winner and kickoff", () => {
  const body = {
    header: {
      competitions: [
        {
          date: "2026-10-13T00:15Z",
          status: { type: { completed: true, description: "Final" } },
          competitors: [
            { team: { displayName: "Los Angeles Rams" }, score: "34", winner: false },
            { team: { displayName: "Buffalo Bills" }, score: "37", winner: true },
          ],
        },
      ],
    },
  };
  const r = parseEspnSummary(body)!;
  assert.equal(r.completed, true);
  assert.equal(r.startAt, Date.parse("2026-10-13T00:15Z") / 1000);
  assert.match(espnResultText(r), /Los Angeles Rams 34, Buffalo Bills 37\. Winner: Buffalo Bills\./);
  assert.equal(parseEspnSummary({}), null);
});

test("'Will X beat Y?' reads the ESPN winner; a draw is a no; unclear names give nothing", async () => {
  const { espnBeatCondition } = await import("../../lib/espn");
  const r = (a: [string, string, boolean], b: [string, string, boolean], completed = true) => ({
    completed, status: completed ? "Final" : "Scheduled", startAt: 0,
    teams: [a, b].map(([name, score, winner]) => ({ name, score, winner })),
  });
  const nfl = r(["Los Angeles Rams", "34", false], ["Buffalo Bills", "37", true]);
  assert.equal(espnBeatCondition("Will Los Angeles Rams beat Buffalo Bills in their NFL game on Oct 13, 2026?", nfl), false);
  assert.equal(espnBeatCondition("Will the Bills beat the Rams?", nfl), true);
  const draw = r(["Lens", "1", false], ["Sporting CP", "1", false]);
  assert.equal(espnBeatCondition("Will Lens beat Sporting CP in their Champions League game on Oct 13, 2026?", draw), false);
  assert.equal(espnBeatCondition("Will Barcelona beat Galatasaray in their Champions League game on Oct 13, 2026?", r(["Galatasaray", "0", false], ["Barcelona", "2", true])), true);
  assert.equal(espnBeatCondition("Will Lens beat Sporting CP?", r(["Lens", "0", false], ["Sporting CP", "0", false], false)), null);
  assert.equal(espnBeatCondition("Will Arsenal beat Chelsea?", nfl), null);
  assert.equal(espnBeatCondition("Who wins tonight?", nfl), null);
});

test("a finished game with no winner and no clear tie is left to the normal path", async () => {
  const { espnBeatCondition } = await import("../../lib/espn");
  const r = { completed: true, status: "Final", startAt: 0, teams: [{ name: "Lens", score: null, winner: false }, { name: "Sporting CP", score: "1", winner: false }] };
  assert.equal(espnBeatCondition("Will Lens beat Sporting CP?", r), null);
});
