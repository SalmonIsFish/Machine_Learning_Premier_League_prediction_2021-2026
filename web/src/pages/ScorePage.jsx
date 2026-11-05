import { useState } from "react";
import ClubBadge from "../components/ClubBadge.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON } from "../lib/data.js";
import { pickOutcome, scorePoints } from "../lib/rules.js";
import { recordResult, useStored } from "../lib/storage.js";

const QUICK = [[1, 0], [2, 1], [1, 1], [0, 0], [2, 0], [0, 1], [1, 2], [0, 2]];
const MAX_GOALS = 20;

/** A scoreboard digit you can type into, with small up/down arrows. */
function GoalInput({ value, onChange, label }) {
  const set = (v) => onChange(Math.max(0, Math.min(MAX_GOALS, v)));
  return (
    <div className="goal-box">
      <input
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

function TeamRow({ team, children, winner }) {
  const { club } = useGame();
  return (
    <div className={"team-row" + (winner ? " winner" : "")} style={{ "--club": club(team).color }}>
      <ClubBadge club={team} />
      <span className="team-row-name">{team}</span>
      {children}
    </div>
  );
}

function ProbBar({ probs, home, away }) {
  const [h, d, a] = probs.map((p) => Math.round(p * 100));
  return (
    <div className="prob">
      <div className="probbar" aria-label={`Machine's chances: ${home} win ${h}%, draw ${d}%, ${away} win ${a}%`}>
        <span className="pb-h" style={{ flexGrow: h }}>{h}%</span>
        <span className="pb-d" style={{ flexGrow: d }}>{d}%</span>
        <span className="pb-a" style={{ flexGrow: a }}>{a}%</span>
      </div>
      <div className="prob-legend"><span>{home} win</span><span>Draw</span><span>{away} win</span></div>
    </div>
  );
}

function PickChip({ who, pick, result }) {
  if (!pick) return <div className="pick-chip miss"><span>{who}</span><b>no pick</b><em>0</em></div>;
  const pts = scorePoints(pick[0], pick[1], result[0], result[1]);
  return (
    <div className={`pick-chip ${pickOutcome(pick, result)}`}>
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
  const fixtures = useLoad(() => getJSON(`${season}/score/${gw}.json`), [season, gw]);
  const reveal = useLoad(() => (revealed ? getJSON(`${season}/score/${gw}.reveal.json`) : Promise.resolve(null)), [season, gw, revealed]);

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
      <div className="page-head">
        <h1>Gameweek {gw} scores</h1>
        <p className="lede">
          Type a score for every match. An exact score is worth 3 points, the right result (win, draw or loss) is worth 1.
        </p>
      </div>

      {totals ? (
        <div className="scoreline-banner reveal-in" aria-live="polite">
          <div><span className="who">You</span><span className="big">{totals.you}</span></div>
          <span className="dash">–</span>
          <div><span className="big">{totals.machine}</span><span className="who">Machine</span></div>
          <p className="verdict">
            {totals.you > totals.machine ? "You won the gameweek." : totals.you < totals.machine ? "The machine won this one." : "Level on points."}
          </p>
        </div>
      ) : (
        <div className="progress" aria-label={`${picked} of ${list.length} matches picked`}>
          <div className="progress-track"><div style={{ width: `${(picked / list.length) * 100}%` }} /></div>
          <span>{picked} of {list.length} picked</span>
        </div>
      )}

      <ol className="fixtures">
        {list.map((f) => {
          const p = picks[f.id];
          const r = rev?.[f.id];
          const done = isPicked(p);
          return (
            <li key={f.id} className={"fixture-card" + (r ? " is-revealed" : done ? " is-picked" : "")}>
              <header className="fc-head">
                <time dateTime={f.kickoff}>{kickoffText(f.kickoff)}</time>
                <span className="fc-status">{r ? "Full time" : done ? "Picked" : "Your call"}</span>
              </header>

              <TeamRow team={f.home} winner={r && r.result[0] > r.result[1]}>
                {r ? <span className="digit">{r.result[0]}</span>
                  : <GoalInput value={p?.[0]} onChange={(v) => setGoal(f.id, 0, v)} label={`${f.home} goals`} />}
              </TeamRow>
              <TeamRow team={f.away} winner={r && r.result[1] > r.result[0]}>
                {r ? <span className="digit">{r.result[1]}</span>
                  : <GoalInput value={p?.[1]} onChange={(v) => setGoal(f.id, 1, v)} label={`${f.away} goals`} />}
              </TeamRow>

              {r ? (
                <div className="fc-reveal">
                  <div className="pick-chips">
                    <PickChip who="You" pick={isPicked(p) ? p : null} result={r.result} />
                    <PickChip who="Machine" pick={r.machine} result={r.result} />
                  </div>
                  <ProbBar probs={r.probs} home={f.home} away={f.away} />
                </div>
              ) : (
                <div className="quick" aria-label="Quick scores">
                  {QUICK.map(([h, a]) => (
                    <button key={`${h}${a}`} type="button" className={p?.[0] === h && p?.[1] === a ? "on" : ""}
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

      <div className="actions sticky-actions">
        {revealed ? (
          <>
            <button type="button" className="ghost" onClick={() => setRevealed(false)}>Play this gameweek again</button>
            {nextGw && <button type="button" className="primary" onClick={() => setGw(nextGw)}>Go to gameweek {nextGw}</button>}
          </>
        ) : (
          <>
            <span className="count">{picked === list.length ? "All matches picked." : `${list.length - picked} still to pick. Unpicked matches score 0.`}</span>
            <button type="button" className="primary" onClick={doReveal} disabled={busy || picked === 0}>
              {busy ? "Revealing…" : "Reveal results"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
