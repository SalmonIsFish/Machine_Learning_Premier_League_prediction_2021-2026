// Plain-language summary of a fantasy gameweek: why each side scored what it did.
import { matchStats, pointsBreakdown } from "./rules.js";

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** All breakdown lines for a player's gameweek (double gameweeks are combined). */
export function playerLines(rev, player, season) {
  const matches = matchStats(rev, player.id);
  return matches.flatMap((s) => pointsBreakdown(player.pos, s, season));
}

/** The 1–2 biggest reasons behind a score, e.g. "a goal (+5) and bonus points (+3)". */
export function mainReasons(rev, player, season, sign = 1) {
  const lines = playerLines(rev, player, season).filter((l) => Math.sign(l.pts) === sign && !l.label.startsWith("Played"));
  lines.sort((a, b) => sign * (b.pts - a.pts));
  const top = lines.slice(0, 2).map((l) => `${l.label.toLowerCase()} (${signed(l.pts)})`);
  return top.join(" and ");
}

/** Build the report: a list of short sentences. */
export function fantasyReport({ rev, byId, season, you, machine }) {
  const pts = (id) => rev.points[id] ?? 0;
  const name = (id) => byId[id]?.short ?? "?";
  const out = [];

  const diff = you.total - machine.total;
  out.push(diff > 0 ? `You beat the machine by ${diff} ${diff === 1 ? "point" : "points"}.`
    : diff < 0 ? `The machine won by ${-diff} ${diff === -1 ? "point" : "points"}.` : "You finished level with the machine.");

  // captains
  const yc = you.captain;
  const mc = machine.captain;
  out.push(yc === mc
    ? `You both captained ${name(yc)}, who scored ${pts(yc)} (doubled to ${pts(yc) * 2}), so the armband made no difference.`
    : `Your captain ${name(yc)} scored ${pts(yc)} (doubled to ${pts(yc) * 2}). The machine captained ${name(mc)}, who scored ${pts(mc)} (doubled to ${pts(mc) * 2}).`);

  // best player on your side
  const bestYou = [...you.xi].sort((a, b) => pts(b) - pts(a))[0];
  if (bestYou && pts(bestYou) > 2) {
    const why = mainReasons(rev, byId[bestYou], season, 1);
    out.push(`Your best player was ${name(bestYou)} with ${pts(bestYou)}${why ? `: ${why}` : ""}.`);
  }

  // negative scores, with the reason
  for (const id of you.xi.filter((i) => pts(i) < 0)) {
    const why = mainReasons(rev, byId[id], season, -1);
    out.push(`${name(id)} lost you ${-pts(id)} ${pts(id) === -1 ? "point" : "points"}${why ? ` because of ${why}` : ""}.`);
  }

  // what decided it: starters only one side had
  const onlyYou = you.xi.filter((i) => !machine.xi.includes(i));
  const onlyMachine = machine.xi.filter((i) => !you.xi.includes(i));
  if (onlyYou.length || onlyMachine.length) {
    const sum = (ids) => ids.reduce((t, i) => t + pts(i), 0);
    const lead = (ids) => {
      const best = [...ids].sort((a, b) => pts(b) - pts(a))[0];
      return best != null && pts(best) > 0 ? `, led by ${name(best)} (${pts(best)})` : "";
    };
    const shared = 11 - onlyYou.length;
    out.push(`You shared ${shared} ${shared === 1 ? "starter" : "starters"} with the machine. Your other ${onlyYou.length} earned ${sum(onlyYou)}${lead(onlyYou)}; the machine's other ${onlyMachine.length} earned ${sum(onlyMachine)}${lead(onlyMachine)}.`);
  }

  // blanks
  const blanks = you.xi.filter((i) => pts(i) <= 1).length;
  if (blanks >= 4) out.push(`${blanks} of your starters scored 1 point or less. Usually that means they came off the bench, didn't play, or their team conceded.`);
  return out;
}

/** Small event icons for a shirt: goals, assists, clean sheet, cards. */
export function eventIcons(rev, player) {
  const s = matchStats(rev, player.id);
  const sum = (k) => s.reduce((t, m) => t + (m[k] || 0), 0);
  const icons = [];
  for (let i = 0; i < sum("g"); i++) icons.push(["⚽", "Goal"]);
  for (let i = 0; i < sum("a"); i++) icons.push(["🅰️", "Assist"]);
  if (sum("cs") && player.pos !== "FWD") icons.push(["🧤", "Clean sheet"]);
  if (sum("yc")) icons.push(["🟨", "Yellow card"]);
  if (sum("rc")) icons.push(["🟥", "Red card"]);
  if (sum("og")) icons.push(["🔄", "Own goal"]);
  return icons;
}
