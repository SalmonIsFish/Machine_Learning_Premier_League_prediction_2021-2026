import { useEffect, useState } from "react";
import Celebration, { outcome } from "../components/Celebration.jsx";
import Jersey from "../components/Jersey.jsx";
import { GiantScoreboard, LedDigit } from "../components/Scoreboard.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON } from "../lib/data.js";
import { pickOutcome, scorePoints } from "../lib/rules.js";
import { playFullTime } from "../lib/sound.js";
import { recordResult, useStored } from "../lib/storage.js";

const QUICK = [[1, 0], [2, 1], [1, 1], [0, 0], [2, 0], [0, 1], [1, 2], [0, 2]];
const MAX_GOALS = 20;

/** An LED tile you can type into, with small up/down arrows. */
function GoalInput({ value, onChange, label }) {
  const set = (v) => onChange(Math.max(0, Math.min(MAX_GOALS, v)));
  return (
    <div className="goal-box">
      <input
        className={value == null ? "empty" : ""}
        type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label={label}
        value={value ?? ""} placeholder="–"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits === "" ? null : Math.min(MAX_GOALS, Number(digits)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); set((value ?? -1) + 1); }
          if (e.key === "ArrowDown") { e.preventDefault(); set((value ?? 1) - 1); }
        }}
      />
      <div className="goal-arrows">
        <button type="button" tabIndex={-1} onClick={() => set((value ?? -1) + 1)} aria-label={`${label}: one more`}>▲</button>
        <button type="button" tabIndex={-1} onClick={() => set((value ?? 1) - 1)} aria-label={`${label}: one fewer`}>▼</button>
      </div>
    </div>
  );
}

function TeamRow({ team, children }) {
  return (
    <div className="team-row">
      <Jersey club={team} size={46} />
      <span className="team-name">{team}</span>
      {children}
    </div>
  );
}

function Odds({ probs, home, away }) {
  const [h, d, a] = probs.map((p) => Math.round(p * 100));
  return (
    <div className="odds">
      <div className="odds-bar" aria-label={`Machine's chances: ${home} win ${h}%, draw ${d}%, ${away} win ${a}%`}>
        <span style={{ flexGrow: h }}>{h}%</span>
        <span style={{ flexGrow: d }}>{d}%</span>
        <span style={{ flexGrow: a }}>{a}%</span>
      </div>
      <div className="odds-legend"><span>{home} win</span><span>Draw</span><span>{away} win</span></div>
    </div>
  );
}

function PickChip({ who, pick, result }) {
  const cls = who === "You" ? "you" : "machine";
  if (!pick) return <div className={`pick-chip miss ${cls}`}><span>{who}</span><b>no pick</b><em>0</em></div>;
  const pts = scorePoints(pick[0], pick[1], result[0], result[1]);
  return (
    <div className={`pick-chip ${pickOutcome(pick, result)} ${cls}`}>
      <span>{who}</span>
      <b>{pick[0]}–{pick[1]}</b>
      <em>{pts ? `+${pts}` : "0"}</em>
    </div>
  );
}

function kickoffText(iso) {
  const d = new Date(iso + "Z");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + ", "
    + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ScorePage() {
  const { season, gw, gameweeks, setGw } = useGame();
  const key = `${season}:${gw}`;
  const [picks, setPicks] = useStored(`score:${key}`, {});
  const [revealed, setRevealed] = useStored(`score-revealed:${key}`, false);
  const [busy, setBusy] = useState(false);
  const [justRevealed, setJustRevealed] = useState(false); // animate only at the moment of the reveal
  const fixtures = useLoad(() => getJSON(`${season}/score/${gw}.json`), [season, gw]);
  const reveal = useLoad(() => (revealed ? getJSON(`${season}/score/${gw}.reveal.json`) : Promise.resolve(null)), [season, gw, revealed]);
  useEffect(() => setJustRevealed(false), [key]);

  if (!season) return <p className="notice">Loading…</p>;
  if (fixtures.error) return <p className="notice error">{fixtures.error}</p>;
  if (fixtures.loading) return <p className="notice">Loading gameweek {gw}…</p>;

  const list = fixtures.data.fixtures;
  const isPicked = (p) => p && p[0] != null && p[1] != null;
  const picked = list.filter((f) => isPicked(picks[f.id])).length;
  const setGoal = (id, side, v) => setPicks((all) => {
    const next = [...(all[id] ?? [null, null])];
    next[side] = v;
    return { ...all, [id]: next };
  });

  const total = (rev) => {
    const t = { you: 0, machine: 0 };
    for (const f of list) {
      const r = rev[f.id];
      const p = picks[f.id];
      if (isPicked(p)) t.you += scorePoints(p[0], p[1], r.result[0], r.result[1]);
      t.machine += scorePoints(r.machine[0], r.machine[1], r.result[0], r.result[1]);
    }
    return t;
  };

  const doReveal = async () => {
    setBusy(true);
    try {
      const rev = await getJSON(`${season}/score/${gw}.reveal.json`);
      const t = total(rev);
      recordResult("score", season, gw, t.you, t.machine);
      playFullTime(outcome(t.you, t.machine));
      setJustRevealed(true);
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  };

  const rev = revealed ? reveal.data : null;
  const totals = rev ? total(rev) : null;
  const nextGw = gameweeks[gameweeks.indexOf(gw) + 1];

  return (
    <section>
      {justRevealed && totals && <Celebration result={outcome(totals.you, totals.machine)} />}
      {totals ? (
        <GiantScoreboard title="Full time" you={totals.you} machine={totals.machine} roll={justRevealed}>
          {totals.you > totals.machine ? "You won the gameweek!" : totals.you < totals.machine ? "The machine won this one." : "Level on points."}
        </GiantScoreboard>
      ) : (
        <div className="hero">
          <h1>Matchday {gw}</h1>
          <p>Type a score for every match. An exact score is worth 3 points, the right result (win, draw or loss) is worth 1.</p>
          <div className="progress" aria-label={`${picked} of ${list.length} matches picked`}>
            <div className="progress-track"><div style={{ width: `${(picked / list.length) * 100}%` }} /></div>
            <b>{picked}/{list.length}</b>
            <span>picked</span>
          </div>
        </div>
      )}

      <ol className="match-grid">
        {list.map((f, n) => {
          const p = picks[f.id];
          const r = rev?.[f.id];
          const done = isPicked(p);
          const state = (a, b) => (a > b ? "winner" : "final");
          return (
            <li key={f.id} className={"match-board" + (r ? " is-revealed" : done ? " is-picked" : "")}>
              <header>
                <time dateTime={f.kickoff}>{kickoffText(f.kickoff)}</time>
                <span className="board-status">{r ? "FT" : done ? "Picked" : "Your call"}</span>
              </header>
              <TeamRow team={f.home}>
                {r ? <LedDigit value={r.result[0]} state={state(r.result[0], r.result[1])} roll={justRevealed} delay={n * 90} />
                  : <GoalInput value={p?.[0]} onChange={(v) => setGoal(f.id, 0, v)} label={`${f.home} goals`} />}
              </TeamRow>
              <TeamRow team={f.away}>
                {r ? <LedDigit value={r.result[1]} state={state(r.result[1], r.result[0])} roll={justRevealed} delay={n * 90} />
                  : <GoalInput value={p?.[1]} onChange={(v) => setGoal(f.id, 1, v)} label={`${f.away} goals`} />}
              </TeamRow>
              {r ? (
                <div className="board-reveal">
                  <div className="pick-chips">
                    <PickChip who="You" pick={isPicked(p) ? p : null} result={r.result} />
                    <PickChip who="Machine" pick={r.machine} result={r.result} />
                  </div>
                  <Odds probs={r.probs} home={f.home} away={f.away} />
                </div>
              ) : (
                <div className="quick" aria-label="Quick scores">
                  {QUICK.map(([h, a]) => (
                    <button key={`${h}${a}`} type="button" className={"chip" + (p?.[0] === h && p?.[1] === a ? " on" : "")}
                      onClick={() => setPicks((all) => ({ ...all, [f.id]: [h, a] }))}>
                      {h}–{a}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="action-bar">
        {revealed ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRevealed(false)}>Play this gameweek again</button>
            {nextGw && <button type="button" className="btn btn-primary" onClick={() => setGw(nextGw)}>Go to gameweek {nextGw}</button>}
          </>
        ) : (
          <>
            <span className="action-note">{picked === list.length ? "All matches picked." : `${list.length - picked} still to pick. Unpicked matches score 0.`}</span>
            <button type="button" className="btn btn-primary" onClick={doReveal} disabled={busy || picked === 0}>
              {busy ? "Revealing…" : "Reveal results"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
