import { useMemo, useState } from "react";
import ClubBadge from "../components/ClubBadge.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON, getPlayerNames, getPool, table } from "../lib/data.js";
import { RULES } from "../lib/rules.js";
import { recordResult, useStored } from "../lib/storage.js";

const AWARDS = [
  { name: "Player of the Season", icon: "🏆", stat: "pts", unit: "pts", hint: "Most FPL points over the season" },
  { name: "Golden Boot", icon: "👟", stat: "g", unit: "goals", hint: "Most goals" },
  { name: "Playmaker", icon: "🎯", stat: "a", unit: "assists", hint: "Most assists" },
  { name: "Golden Glove", icon: "🧤", stat: "cs", unit: "clean sheets", hint: "Goalkeeper with the most clean sheets", gk: true },
];

/** One player as a scorebug row: club stripe, badge, name, and a stat in a scoreboard digit. */
function PlayerRow({ player, stat, unit, onClick, children, tone }) {
  const { club } = useGame();
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={"player-row" + (tone ? ` ${tone}` : "")}
      style={{ "--club": club(player.club).color }} onClick={onClick}>
      <ClubBadge club={player.club} />
      <span className="pr-text">
        <span className="pr-name">{player.name}</span>
        <span className="pr-club">{player.pos ? `${player.pos} · ` : ""}{player.club}</span>
      </span>
      {stat != null && (
        <span className="pr-stat">
          <span className="pr-digit">{stat}</span>
          <span className="pr-unit">{unit}</span>
        </span>
      )}
      {children}
    </Tag>
  );
}

function PlayerSearch({ options, value, onChange, stat, unit, label }) {
  const [q, setQ] = useState("");
  const chosen = options.find((o) => o.id === value);
  if (chosen) {
    return (
      <div className="pick-box">
        <span className="pick-label">Your pick</span>
        <PlayerRow player={chosen} stat={stat(chosen)} unit={unit} tone="chosen">
          <button type="button" className="ghost small change" onClick={() => onChange(null)}>Change</button>
        </PlayerRow>
      </div>
    );
  }
  const ql = q.trim().toLowerCase();
  const matches = (ql ? options.filter((o) => o.name.toLowerCase().includes(ql) || o.short.toLowerCase().includes(ql)) : options).slice(0, 5);
  return (
    <div className="pick-box">
      <input className="pick-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search any player" aria-label={label} />
      <div className="pick-list" role="list">
        {matches.map((o) => (
          <PlayerRow key={o.id} player={o} stat={stat(o)} unit={unit} onClick={() => { onChange(o.id); setQ(""); }} />
        ))}
        {matches.length === 0 && <p className="empty">No players match “{q}”.</p>}
      </div>
    </div>
  );
}

function Verdict({ who, name, hit }) {
  return (
    <div className={"verdict-chip " + (hit ? "hit" : "miss")}>
      <span className="vc-who">{who}</span>
      <span className="vc-name">{name ?? "no pick"}</span>
      <span className="vc-pts">{hit ? `✔ +${RULES.awardPoints}` : "✘ 0"}</span>
    </div>
  );
}

function Stepper({ value, options, onChange, label }) {
  const i = options.indexOf(value);
  return (
    <div className="gw-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(options[i - 1])} disabled={i <= 0} aria-label={`Previous ${label}`}>‹</button>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {options.map((g) => <option key={g} value={g}>Gameweek {g}</option>)}
      </select>
      <button type="button" onClick={() => onChange(options[i + 1])} disabled={i >= options.length - 1} aria-label={`Next ${label}`}>›</button>
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
    setRevealed(true);
  };

  const picked = AWARDS.filter((a) => picks[a.name]).length;
  const result = revealed ? rev.data : null;
  const totals = result ? score(result) : null;
  const nm = (id) => byId[id]?.name ?? "a player who hadn't played yet";

  return (
    <section>
      <div className="page-head">
        <h1>{season} awards</h1>
        <p className="lede">
          Call the season's winners from part-way through. Each correct award is worth {RULES.awardPoints} points.
        </p>
      </div>

      <div className="awards-toolbar">
        <Stepper value={after} options={choices} onChange={setAfter} label="predict after gameweek" />
        <p>Stats below are up to gameweek {after}. The machine projects the rest of the season from there.</p>
      </div>

      {totals ? (
        <div className="scoreline-banner reveal-in" aria-live="polite">
          <div><span className="who">You</span><span className="big">{totals.you}</span></div>
          <span className="dash">–</span>
          <div><span className="big">{totals.machine}</span><span className="who">Machine</span></div>
        </div>
      ) : (
        <div className="progress" aria-label={`${picked} of ${AWARDS.length} awards picked`}>
          <div className="progress-track"><div style={{ width: `${(picked / AWARDS.length) * 100}%` }} /></div>
          <span>{picked} of {AWARDS.length} picked</span>
        </div>
      )}

      <div className="award-grid">
        {AWARDS.map((a) => {
          const options = people.filter((p) => !a.gk || p.pos === "GK").sort((x, y) => y[a.stat] - x[a.stat] || y.pts - x.pts);
          const winners = result?.winners[a.name] ?? [];
          return (
            <article key={a.name} className={"award-card" + (picks[a.name] && !result ? " is-picked" : "") + (result ? " is-revealed" : "")}>
              <header className="ac-head">
                <span className="ac-icon" aria-hidden="true">{a.icon}</span>
                <div>
                  <h2>{a.name}</h2>
                  <p>{a.hint}</p>
                </div>
              </header>
              {result ? (
                <div className="ac-result">
                  <div className="winner-row">
                    <span className="wr-label">Winner</span>
                    {winners.map((id) => byId[id]
                      ? <PlayerRow key={id} player={byId[id]} tone="won" />
                      : <p key={id} className="wr-name">{nm(id)}</p>)}
                  </div>
                  <div className="verdicts">
                    <Verdict who="You" name={picks[a.name] ? nm(picks[a.name]) : null} hit={winners.includes(picks[a.name])} />
                    <Verdict who="Machine" name={nm(result.machine[a.name])} hit={winners.includes(result.machine[a.name])} />
                  </div>
                  <details className="projection">
                    <summary>Machine's projected top 5</summary>
                    <ol>
                      {result.projections[a.name].map(([id, v]) => (
                        <li key={id}><span>{nm(id)}</span><b>{v}</b></li>
                      ))}
                    </ol>
                  </details>
                </div>
              ) : (
                <PlayerSearch options={options} value={picks[a.name] ?? null} label={`${a.name} pick`}
                  onChange={(id) => setPicks((p) => ({ ...p, [a.name]: id }))} stat={(o) => o[a.stat]} unit={a.unit} />
              )}
            </article>
          );
        })}
      </div>

      <div className="actions">
        {revealed ? (
          <button type="button" className="ghost" onClick={() => setRevealed(false)}>Change my picks</button>
        ) : (
          <>
            <span className="count">{picked === AWARDS.length ? "All awards picked." : `${AWARDS.length - picked} still to pick.`}</span>
            <button type="button" className="primary" disabled={picked === 0} onClick={doReveal}>Reveal winners</button>
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
    setRevealed(true);
  };
  const byId = Object.fromEntries((pool.data ?? []).map((p) => [p.id, p]));
  const r = revealed ? rev.data : null;

  return (
    <section className="potw">
      <div className="page-head">
        <h2 className="section-title">Player of the week</h2>
        <p className="lede">Who scores the most FPL points in one gameweek? It's the hardest call here, and the machine rarely gets it either.</p>
      </div>
      <div className="awards-toolbar">
        <Stepper value={gw} options={gws} onChange={setGw} label="gameweek" />
      </div>
      <article className={"award-card potw-card" + (pick && !r ? " is-picked" : "") + (r ? " is-revealed" : "")}>
        <header className="ac-head">
          <span className="ac-icon" aria-hidden="true">⭐</span>
          <div>
            <h2>Gameweek {gw}</h2>
            <p>Most FPL points this week. The number shown is recent form (average points over the last 5 gameweeks).</p>
          </div>
        </header>
        {pool.loading ? <p className="notice">Loading players…</p> : r ? (
          <div className="ac-result">
            <div className="winner-row">
              <span className="wr-label">Winner, {r.topPoints} pts</span>
              {r.topScorers.map((id) => byId[id] && <PlayerRow key={id} player={byId[id]} stat={r.points[id]} unit="pts" tone="won" />)}
            </div>
            <div className="verdicts">
              <Verdict who="You" name={byId[pick] ? `${byId[pick].name} (${r.points[pick] ?? 0} pts)` : null} hit={r.topScorers.includes(pick)} />
              <Verdict who="Machine" name={`${byId[r.machinePotw]?.name} (${r.points[r.machinePotw] ?? 0} pts)`} hit={r.topScorers.includes(r.machinePotw)} />
            </div>
          </div>
        ) : (
          <PlayerSearch options={options} value={pick} onChange={setPick} label="Player of the week pick"
            stat={(o) => o.form ?? "–"} unit="form" />
        )}
      </article>
      <div className="actions">
        {revealed ? (
          <button type="button" className="ghost" onClick={() => setRevealed(false)}>Pick again</button>
        ) : (
          <button type="button" className="primary" disabled={!pick} onClick={doReveal}>Reveal player of the week</button>
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
