import { useEffect, useMemo, useState } from "react";
import Celebration, { outcome } from "../components/Celebration.jsx";
import Jersey from "../components/Jersey.jsx";
import PlayerCard, { tierForPrice } from "../components/PlayerCard.jsx";
import { GiantScoreboard, GwStepper } from "../components/Scoreboard.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON, getPlayerNames, getPool, table } from "../lib/data.js";
import { RULES } from "../lib/rules.js";
import { playFullTime } from "../lib/sound.js";
import { recordResult, useStored } from "../lib/storage.js";

const AWARDS = [
  { name: "Player of the Season", icon: "🏆", stat: "pts", unit: "pts", foot: "pts so far", hint: "Most FPL points over the season" },
  { name: "Golden Boot", icon: "👟", stat: "g", unit: "goals", foot: "goals so far", hint: "Most goals" },
  { name: "Playmaker", icon: "🎯", stat: "a", unit: "assists", foot: "assists so far", hint: "Most assists" },
  { name: "Golden Glove", icon: "🧤", stat: "cs", unit: "clean sheets", foot: "clean sheets", hint: "Goalkeeper with the most clean sheets", gk: true },
];

/** Tier from how high a player ranks for this award: top 3 gold, top 15 silver, the rest bronze. */
const tierForRank = (rank) => (rank < 3 ? "gold" : rank < 15 ? "silver" : "bronze");

function CandidateRow({ player, value, onClick }) {
  return (
    <button type="button" className="candidate" onClick={onClick}>
      <Jersey club={player.club} size={34} />
      <span className="candidate-text">
        <b>{player.short || player.name}</b>
        <small>{player.club}</small>
      </span>
      <span className="candidate-num">{value}</span>
    </button>
  );
}

function SearchList({ options, value, label, onPick }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matches = (ql ? options.filter((o) => o.name.toLowerCase().includes(ql) || o.short.toLowerCase().includes(ql)) : options).slice(0, 4);
  return (
    <div className="search-list">
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player" aria-label={label} />
      {matches.map((o) => <CandidateRow key={o.id} player={o} value={value(o)} onClick={() => { onPick(o.id); setQ(""); }} />)}
      {matches.length === 0 && <p className="empty">No players match “{q}”.</p>}
    </div>
  );
}

function Verdict({ who, name, hit }) {
  return (
    <div className={`verdict ${who === "You" ? "you" : "machine"}` + (hit ? " hit" : "")}>
      <span className="verdict-text">
        <small>{who}</small>
        <b>{name ?? "No pick"}</b>
      </span>
      <em>{hit ? `✔ +${RULES.awardPoints}` : "✘ 0"}</em>
    </div>
  );
}

function SeasonAwards() {
  const { season, index } = useGame();
  const choices = index.seasons.find((s) => s.season === season).gameweeks.slice(0, -1);
  const [afterRaw, setAfter] = useStored(`awards-after:${season}`, 19);
  const after = choices.includes(afterRaw) ? afterRaw : choices[Math.min(18, choices.length - 1)];
  const key = `${season}:${after}`;
  const [picks, setPicks] = useStored(`awards:${key}`, {});
  const [revealed, setRevealed] = useStored(`awards-revealed:${key}`, false);
  const [justRevealed, setJustRevealed] = useState(false);
  useEffect(() => setJustRevealed(false), [key]);

  const data = useLoad(async () => {
    const [c, names] = await Promise.all([getJSON(`${season}/awards/${after}.json`), getPlayerNames(season)]);
    return table(c).map((p) => ({ ...p, name: names[p.id]?.[0] ?? `#${p.id}`, short: names[p.id]?.[1] ?? "" }));
  }, [season, after]);
  const rev = useLoad(async () => {
    if (!revealed) return null;
    const [r, w] = await Promise.all([getJSON(`${season}/awards/${after}.reveal.json`), getJSON(`${season}/awards/winners.json`)]);
    return { ...r, winners: w };
  }, [season, after, revealed]);

  if (data.error) return <p className="notice error">{data.error}</p>;
  if (data.loading) return <p className="notice">Loading players…</p>;

  const people = data.data;
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const score = (r) => {
    const t = { you: 0, machine: 0 };
    for (const a of AWARDS) {
      if (r.winners[a.name].includes(picks[a.name])) t.you += RULES.awardPoints;
      if (r.winners[a.name].includes(r.machine[a.name])) t.machine += RULES.awardPoints;
    }
    return t;
  };
  const doReveal = async () => {
    const [r, w] = await Promise.all([getJSON(`${season}/awards/${after}.reveal.json`), getJSON(`${season}/awards/winners.json`)]);
    const t = score({ ...r, winners: w });
    recordResult("awards", season, after, t.you, t.machine);
    playFullTime(outcome(t.you, t.machine));
    setJustRevealed(true);
    setRevealed(true);
  };

  const picked = AWARDS.filter((a) => picks[a.name]).length;
  const result = revealed ? rev.data : null;
  const totals = result ? score(result) : null;
  const nm = (id) => byId[id]?.short || byId[id]?.name || "A later signing";

  return (
    <section>
      {justRevealed && totals && <Celebration result={outcome(totals.you, totals.machine)} />}
      {totals ? (
        <GiantScoreboard title="Awards night" you={totals.you} machine={totals.machine} roll={justRevealed} tone="cyan" />
      ) : (
        <div className="hero">
          <h1>The trophy cabinet</h1>
          <p>Call the season's winners from part-way through. Each correct award is worth {RULES.awardPoints} points.</p>
        </div>
      )}
      <div className="predict-after">
        <span>Predict after</span>
        <GwStepper value={after} options={choices} onChange={setAfter} label="Predict after gameweek" />
        <small>Stats are up to this gameweek. The machine projects the rest of the season from there.</small>
      </div>

      <div className="cabinets">
        {AWARDS.map((a) => {
          const options = people.filter((p) => !a.gk || p.pos === "GK").sort((x, y) => y[a.stat] - x[a.stat] || y.pts - x.pts);
          const chosen = options.find((o) => o.id === picks[a.name]);
          const winners = result?.winners[a.name] ?? [];
          const winner = byId[winners[0]];
          return (
            <article key={a.name} className={"cabinet" + (chosen && !result ? " is-picked" : "")}>
              <div className="trophy" aria-hidden="true">{a.icon}</div>
              <h2>{a.name}</h2>
              <p className="cabinet-hint">{a.hint}</p>
              {result ? (
                <>
                  <div className="shelf">
                    {winner ? <PlayerCard name={winner.short} pos={winner.pos} club={winner.club} value="WIN" foot="Winner" tier="star" /> : <p className="winner-name">{nm(winners[0])}</p>}
                  </div>
                  {winners.length > 1 && <p className="cabinet-hint">Shared with {winners.slice(1).map(nm).join(", ")}</p>}
                  <Verdict who="You" name={picks[a.name] ? nm(picks[a.name]) : null} hit={winners.includes(picks[a.name])} />
                  <Verdict who="Machine" name={nm(result.machine[a.name])} hit={winners.includes(result.machine[a.name])} />
                  <div className="projection">
                    <h3>Machine's projection</h3>
                    <ol>{result.projections[a.name].map(([id, v]) => <li key={id}><span>{nm(id)}</span><b>{v}</b></li>)}</ol>
                  </div>
                </>
              ) : chosen ? (
                <>
                  <div className="shelf">
                    <PlayerCard name={chosen.short} pos={chosen.pos} club={chosen.club} value={chosen[a.stat]} foot={a.foot} tier={tierForRank(options.indexOf(chosen))} />
                  </div>
                  <button type="button" className="your-pick" onClick={() => setPicks((p) => ({ ...p, [a.name]: null }))}>Your pick. Change</button>
                </>
              ) : (
                <SearchList options={options} value={(o) => o[a.stat]} label={`${a.name} pick`} onPick={(id) => setPicks((p) => ({ ...p, [a.name]: id }))} />
              )}
            </article>
          );
        })}
      </div>

      <div className="section-actions">
        {revealed ? (
          <button type="button" className="btn btn-ghost" onClick={() => setRevealed(false)}>Change my picks</button>
        ) : (
          <>
            <span className="action-note">{picked === AWARDS.length ? "All awards picked." : `${picked} of ${AWARDS.length} awards picked.`}</span>
            <button type="button" className="btn btn-primary" disabled={picked === 0} onClick={doReveal}>Reveal winners</button>
          </>
        )}
      </div>
    </section>
  );
}

function PlayerOfTheWeek() {
  const { season, index } = useGame();
  const gws = index.seasons.find((s) => s.season === season).gameweeks;
  const [gwRaw, setGw] = useStored(`potw-gw:${season}`, gws[0]);
  const gw = gws.includes(gwRaw) ? gwRaw : gws[0];
  const key = `${season}:${gw}`;
  const [pick, setPick] = useStored(`potw:${key}`, null);
  const [revealed, setRevealed] = useStored(`potw-revealed:${key}`, false);
  const pool = useLoad(() => getPool(season, gw), [season, gw]);
  const rev = useLoad(() => (revealed ? getJSON(`${season}/fantasy/${gw}.reveal.json`) : Promise.resolve(null)), [season, gw, revealed]);
  const options = useMemo(() => (pool.data ?? []).filter((p) => p.nfix > 0).sort((a, b) => (b.form ?? 0) - (a.form ?? 0)), [pool.data]);

  const doReveal = async () => {
    const r = await getJSON(`${season}/fantasy/${gw}.reveal.json`);
    const pts = (id) => (r.topScorers.includes(id) ? RULES.awardPoints : 0);
    recordResult("potw", season, gw, pts(pick), pts(r.machinePotw));
    playFullTime(outcome(pts(pick), pts(r.machinePotw)));
    setRevealed(true);
  };
  const byId = Object.fromEntries((pool.data ?? []).map((p) => [p.id, p]));
  const r = revealed ? rev.data : null;
  const chosen = byId[pick];
  const star = r ? byId[r.topScorers[0]] : null;

  return (
    <section className="potw panel">
      <div className="potw-head">
        <div>
          <h2><span aria-hidden="true">⭐ </span>Player of the week</h2>
          <p>Who scores the most FPL points in one gameweek? The hardest call here, and the machine rarely gets it either.</p>
        </div>
        <GwStepper value={gw} options={gws} onChange={setGw} label="Player of the week gameweek" />
      </div>
      {pool.loading ? <p className="notice">Loading players…</p> : r ? (
        <div className="potw-result">
          {star && <PlayerCard name={star.short} pos={star.pos} club={star.club} value={`${r.topPoints} pts`} foot="Winner" tier="star" />}
          <div className="potw-verdicts">
            {r.topScorers.length > 1 && <p className="cabinet-hint">Joint winners: {r.topScorers.map((id) => byId[id]?.short).join(", ")}</p>}
            <Verdict who="You" name={chosen ? `${chosen.short} (${r.points[pick] ?? 0} pts)` : null} hit={r.topScorers.includes(pick)} />
            <Verdict who="Machine" name={`${byId[r.machinePotw]?.short} (${r.points[r.machinePotw] ?? 0} pts)`} hit={r.topScorers.includes(r.machinePotw)} />
          </div>
        </div>
      ) : chosen ? (
        <div className="potw-result">
          <PlayerCard name={chosen.short} pos={chosen.pos} club={chosen.club} value={chosen.form ?? "–"} foot={`£${chosen.price.toFixed(1)}m`} tier={tierForPrice(chosen.price)} />
          <button type="button" className="your-pick" onClick={() => setPick(null)}>Your pick. Change</button>
        </div>
      ) : (
        <div className="potw-pick"><SearchList options={options} value={(o) => o.form ?? "–"} label="Player of the week pick" onPick={setPick} /></div>
      )}
      <div className="section-actions">
        {revealed ? (
          <button type="button" className="btn btn-ghost" onClick={() => setRevealed(false)}>Pick again</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!pick} onClick={doReveal}>Reveal player of the week</button>
        )}
      </div>
    </section>
  );
}

export default function AwardsPage() {
  const { season, index } = useGame();
  if (!season || !index) return <p className="notice">Loading…</p>;
  return (
    <>
      <SeasonAwards key={season} />
      <PlayerOfTheWeek key={`potw-${season}`} />
    </>
  );
}
