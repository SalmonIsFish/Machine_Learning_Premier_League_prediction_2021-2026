// Game rules, ported from src/pl.py (score_points, validate_squad, team_points).
// rules.test.js checks these against answers exported from Python.

export const RULES = {
  budget: 100,
  maxPerClub: 3,
  squad: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
  xi: { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] },
  exactPoints: 3,
  resultPoints: 1,
  awardPoints: 5,
};

export const POSITIONS = ["GK", "DEF", "MID", "FWD"];

/** 3 points for the exact score, 1 for the right result (home win / draw / away win), otherwise 0. */
export function scorePoints(predHome, predAway, actHome, actAway) {
  if (predHome === actHome && predAway === actAway) return RULES.exactPoints;
  return Math.sign(predHome - predAway) === Math.sign(actHome - actAway) ? RULES.resultPoints : 0;
}

/** "exact" | "result" | "miss", for colouring a reveal. */
export function pickOutcome(pred, actual) {
  const pts = scorePoints(pred[0], pred[1], actual[0], actual[1]);
  return pts === RULES.exactPoints ? "exact" : pts === RULES.resultPoints ? "result" : "miss";
}

/**
 * Check a fantasy team. `players` maps id -> {pos, club, price}.
 * Returns a list of problems in plain words (empty list = valid team).
 */
export function validateSquad(players, squadIds, xiIds, captainId) {
  const errors = [];
  const squad = [...new Set(squadIds)].filter((id) => players[id]).map((id) => players[id]);
  const unique = new Set(squadIds).size;
  if (unique !== 15) errors.push(`Pick 15 different players (you have ${unique}).`);

  for (const pos of POSITIONS) {
    const n = squad.filter((p) => p.pos === pos).length;
    if (n !== RULES.squad[pos]) errors.push(`Squad needs exactly ${RULES.squad[pos]} ${pos} (you have ${n}).`);
  }

  const cost = squad.reduce((s, p) => s + p.price, 0);
  if (cost > RULES.budget + 1e-9) errors.push(`Squad costs £${cost.toFixed(1)}m; the budget is £${RULES.budget}m.`);

  const clubs = {};
  for (const p of squad) clubs[p.club] = (clubs[p.club] || 0) + 1;
  for (const [club, n] of Object.entries(clubs)) {
    if (n > RULES.maxPerClub) errors.push(`${n} players from ${club} (the limit is ${RULES.maxPerClub}).`);
  }

  const xiSet = new Set(xiIds);
  const inSquad = [...xiSet].every((id) => squadIds.includes(id));
  if (xiSet.size !== 11 || !inSquad) errors.push(`Start 11 players from your squad (you have ${xiSet.size}).`);

  const xi = [...xiSet].filter((id) => players[id]).map((id) => players[id]);
  for (const pos of POSITIONS) {
    const [lo, hi] = RULES.xi[pos];
    const n = xi.filter((p) => p.pos === pos).length;
    if (n < lo || n > hi) errors.push(lo === hi ? `Start exactly ${lo} ${pos} (you have ${n}).` : `Start ${lo}–${hi} ${pos} (you have ${n}).`);
  }

  if (!xiSet.has(captainId)) errors.push("Choose a captain from your starting 11.");
  return errors;
}

// ---------------------------------------------------------------- FPL points breakdown
// The official FPL scoring table. FPL tweaked a few rules over the seasons, so anything the table
// doesn't explain is shown as "Other FPL scoring" and the lines always add up to the real total.
const GOAL_PTS = { GK: 6, DEF: 6, MID: 5, FWD: 4 };
const CLEAN_SHEET_PTS = { GK: 4, DEF: 4, MID: 1, FWD: 0 };
const DEF_CONTRIB_NEEDED = { DEF: 10, MID: 12, FWD: 12 }; // from 2025-26: +2 for this many tackles, blocks, ...

const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

/** Turn one match's stats into [{label, pts}] lines that add up to the FPL points. */
export function pointsBreakdown(pos, s, season) {
  const lines = [];
  const add = (label, pts) => pts !== 0 && lines.push({ label, pts });
  if (s.min === 0) lines.push({ label: "Didn't play", pts: 0 });
  else add(`Played ${s.min} min${s.min < 60 ? " (under 60)" : ""}`, s.min >= 60 ? 2 : 1);
  add(plural(s.g, "goal"), s.g * GOAL_PTS[pos]);
  add(plural(s.a, "assist"), s.a * 3);
  add("Clean sheet", s.cs * CLEAN_SHEET_PTS[pos]);
  if (pos === "GK" || pos === "DEF") add(`Conceded ${plural(s.gc, "goal")}`, -Math.floor(s.gc / 2));
  add(plural(s.sv, "save"), pos === "GK" ? Math.floor(s.sv / 3) : 0);
  add(plural(s.ps, "penalty save"), s.ps * 5);
  add(plural(s.pm, "missed penalty", "missed penalties"), s.pm * -2);
  add(plural(s.og, "own goal"), s.og * -2);
  add(s.yc > 1 ? plural(s.yc, "yellow card") : "Yellow card", s.yc * -1);
  add("Red card", s.rc * -3);
  if (season >= "2025-26" && DEF_CONTRIB_NEEDED[pos] && s.dc >= DEF_CONTRIB_NEEDED[pos]) {
    add(`${s.dc} defensive actions`, 2);
  }
  add("Bonus points", s.bonus);
  const explained = lines.reduce((t, l) => t + l.pts, 0);
  if (explained !== s.pts) lines.push({ label: "Other FPL scoring", pts: s.pts - explained });
  return lines;
}

/** Stats rows from a reveal file -> objects keyed by the column names. */
export function matchStats(reveal, id) {
  return (reveal.stats?.[id] ?? []).map((row) => Object.fromEntries(reveal.statCols.map((c, i) => [c, row[i]])));
}

/** FPL points of a starting XI: captain counts double, no automatic substitutions. */
export function teamPoints(points, xiIds, captainId) {
  const get = (id) => points[id] ?? 0;
  return xiIds.reduce((s, id) => s + get(id), 0) + get(captainId);
}
