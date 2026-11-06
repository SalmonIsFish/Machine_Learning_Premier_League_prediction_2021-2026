import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KITS } from "./kits.js";
import { matchStats, pointsBreakdown, scorePoints, teamPoints, validateSquad } from "./rules.js";

// Answers computed by src/pl.py (written by scripts/export_web_data.py)
const cases = JSON.parse(readFileSync(new URL("../../public/data/test_cases.json", import.meta.url), "utf-8"));
const read = (rel) => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), "utf-8"));

describe("score predictor", () => {
  it("matches Python on all 256 scorelines", () => {
    for (const [ph, pa, ah, aa, expected] of cases.score) {
      expect(scorePoints(ph, pa, ah, aa), `${ph}-${pa} vs ${ah}-${aa}`).toBe(expected);
    }
  });
});

describe("shirts", () => {
  it("every club in the data has a kit", () => {
    const missing = Object.keys(read("index.json").clubs).filter((club) => !KITS[club]);
    expect(missing).toEqual([]);
  });
});

describe("points breakdown", () => {
  const index = read("index.json");
  // every season, a few gameweeks: the scoring table should explain almost every player's points exactly
  for (const { season } of index.seasons) {
    it(`${season}: lines add up, and the scoring table explains ≥ 97% of scores`, () => {
      let total = 0;
      let explained = 0;
      for (const gw of [1, 10, 20, 30]) {
        const pool = read(`${season}/fantasy/${gw}.json`);
        const rev = read(`${season}/fantasy/${gw}.reveal.json`);
        const pos = Object.fromEntries(pool.rows.map(([id, p]) => [id, p]));
        for (const id of Object.keys(rev.stats)) {
          for (const s of matchStats(rev, id)) {
            const lines = pointsBreakdown(pos[id], s, season);
            expect(lines.reduce((t, l) => t + l.pts, 0)).toBe(s.pts);
            total += 1;
            if (!lines.some((l) => l.label === "Other FPL scoring")) explained += 1;
          }
        }
      }
      expect(explained / total).toBeGreaterThan(0.97);
    });
  }
});

describe("fantasy rules", () => {
  const pool = read(`${cases.season}/fantasy/${cases.gw}.json`);
  const reveal = read(`${cases.season}/fantasy/${cases.gw}.reveal.json`);
  const players = Object.fromEntries(pool.rows.map(([id, pos, club, price]) => [id, { pos, club, price }]));

  for (const c of cases.squads) {
    it(`${c.name}: valid=${c.valid}, points=${c.points}`, () => {
      expect(validateSquad(players, c.squad, c.xi, c.captain).length === 0).toBe(c.valid);
      expect(teamPoints(reveal.points, c.xi, c.captain)).toBe(c.points);
    });
  }

  it("rejects 4 players from one club", () => {
    const base = cases.squads[0];
    const club = players[base.squad[0]].club;
    const sameClub = pool.rows.filter((r) => r[2] === club).map((r) => r[0]);
    const squad = [...new Set([...sameClub.slice(0, 4), ...base.squad])].slice(0, 15);
    const errors = validateSquad(players, squad, base.xi, base.captain);
    expect(errors.some((e) => e.includes(club))).toBe(true);
  });
});
