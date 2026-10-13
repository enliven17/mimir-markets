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
