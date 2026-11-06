import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GiantScoreboard } from "../components/Scoreboard.jsx";
import { clearAll, loadResults } from "../lib/storage.js";

const GAMES = [
  { key: "score", name: "Score predictor", round: "Gameweek" },
  { key: "fantasy", name: "Fantasy", round: "Gameweek" },
  { key: "awards", name: "Awards", round: "After gameweek" },
  { key: "potw", name: "Player of the week", round: "Gameweek" },
];
const YOU = "#FFB81C";
const MACHINE = "#27E0FF";

function rows(results, game) {
  return Object.entries(results[game] ?? {})
    .map(([k, v]) => {
      const [season, round] = k.split("|");
      return { season, round: Number(round), ...v };
    })
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
}

export default function LeaderboardPage() {
  const [results, setResults] = useState(loadResults);
  const [game, setGame] = useState("score");
  const [season, setSeason] = useState(null);
  useEffect(() => {
    const refresh = () => setResults(loadResults());
    window.addEventListener("pl-storage", refresh);
    return () => window.removeEventListener("pl-storage", refresh);
  }, []);

  const all = GAMES.flatMap((g) => rows(results, g.key));
  const youTotal = all.reduce((s, r) => s + r.you, 0);
  const machineTotal = all.reduce((s, r) => s + r.machine, 0);
  const list = rows(results, game);
  const seasons = [...new Set(list.map((r) => r.season))];
  const shownSeason = seasons.includes(season) ? season : seasons[seasons.length - 1];
  const current = GAMES.find((g) => g.key === game);
  let you = 0;
  let machine = 0;
  const chart = list.filter((r) => r.season === shownSeason).map((r) => {
    you += r.you;
    machine += r.machine;
    return { round: r.round, You: you, Machine: machine };
  });

  const exportData = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "you-vs-machine-results.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const reset = () => {
    if (window.confirm("Delete all your picks and results in this browser? This can't be undone.")) {
      clearAll();
      setResults({});
    }
  };

  return (
    <section>
      <GiantScoreboard title="Season scoreboard" you={youTotal} machine={machineTotal}>
        {all.length === 0 ? "Nothing played yet. Reveal a round in any game and your score appears here." : "All your games, saved in this browser."}
      </GiantScoreboard>

      {all.length > 0 && (
        <>
          <div className="totals">
            {GAMES.map((g) => {
              const r = rows(results, g.key);
              const y = r.reduce((s, x) => s + x.you, 0);
              const m = r.reduce((s, x) => s + x.machine, 0);
              const wins = r.filter((x) => x.you > x.machine).length;
              return (
                <button key={g.key} type="button" className={"total" + (game === g.key ? " on" : "")} onClick={() => setGame(g.key)} disabled={!r.length} aria-pressed={game === g.key}>
                  <span className="total-name">{g.name}</span>
                  <span className="total-score"><b className="you">{y}</b><i>:</i><b className="machine">{m}</b></span>
                  <span className="total-meta">{r.length ? `${r.length} played, ${wins} won` : "Not played yet"}</span>
                </button>
              );
            })}
          </div>

          {list.length > 0 && (
            <div className="board-lower">
              <div className="panel chart-panel">
                <div className="chart-head">
                  <h2>{current.name}: running total</h2>
                  {seasons.length > 1 && (
                    <select value={shownSeason} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
                      {seasons.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chart} margin={{ top: 10, right: 16, bottom: 4, left: -14 }}>
                    <CartesianGrid stroke="rgba(237,244,255,0.12)" vertical={false} />
                    <XAxis dataKey="round" stroke="#9FB0CC" tickLine={false} />
                    <YAxis stroke="#9FB0CC" tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#0B1426", border: "1px solid #3A4C78", color: "#EDF4FF" }} labelFormatter={(r) => `${current.round} ${r}`} />
                    <Line type="monotone" dataKey="Machine" stroke={MACHINE} strokeWidth={3} dot={{ r: 4, fill: MACHINE }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="You" stroke={YOU} strokeWidth={3} dot={{ r: 4, fill: YOU }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="legend"><span className="you">● You</span><span className="machine">● Machine</span></div>
              </div>
              <div className="panel rounds">
                <h2>Latest rounds</h2>
                <ul>
                  {list.slice().reverse().slice(0, 12).map((r) => (
                    <li key={`${r.season}-${r.round}`}>
                      <span>{r.season}, {current.round === "Gameweek" ? "GW" : "after GW"} {r.round}</span>
                      <span className="round-score">
                        <b className={r.you > r.machine ? "you" : ""}>{r.you}</b>
                        <i>–</i>
                        <b className={r.machine > r.you ? "machine" : ""}>{r.machine}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="section-actions">
            <button type="button" className="btn btn-ghost" onClick={exportData}>Download my results</button>
            <button type="button" className="btn btn-ghost danger" onClick={reset}>Delete all results</button>
          </div>
        </>
      )}
    </section>
  );
}
