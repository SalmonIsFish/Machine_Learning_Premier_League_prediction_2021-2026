import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clearAll, loadResults } from "../lib/storage.js";

const GAMES = [
  { key: "score", name: "Score predictor", round: "Gameweek" },
  { key: "fantasy", name: "Fantasy", round: "Gameweek" },
  { key: "awards", name: "Awards", round: "After gameweek" },
  { key: "potw", name: "Player of the week", round: "Gameweek" },
];
const YOU = "#F5D547";
const MACHINE = "#8FD3E8";

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
  useEffect(() => {
    const refresh = () => setResults(loadResults());
    window.addEventListener("pl-storage", refresh);
    return () => window.removeEventListener("pl-storage", refresh);
  }, []);

  const played = GAMES.filter((g) => rows(results, g.key).length > 0);
  const list = rows(results, game);
  const seasons = [...new Set(list.map((r) => r.season))];
  const [season, setSeason] = useState(null);
  const shownSeason = seasons.includes(season) ? season : seasons[seasons.length - 1];
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

  if (played.length === 0) {
    return (
      <section>
        <div className="page-head">
          <h1>Leaderboard</h1>
          <p className="lede">Nothing played yet. Reveal a gameweek in any game and your score against the machine appears here.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p className="lede">Your totals against the machine, saved in this browser.</p>
      </div>

      <div className="totals">
        {GAMES.map((g) => {
          const r = rows(results, g.key);
          const y = r.reduce((s, x) => s + x.you, 0);
          const m = r.reduce((s, x) => s + x.machine, 0);
          const wins = r.filter((x) => x.you > x.machine).length;
          return (
            <button key={g.key} type="button" className={"total" + (game === g.key ? " on" : "")} onClick={() => setGame(g.key)} disabled={!r.length}>
              <span className="total-name">{g.name}</span>
              <span className="total-score"><b className="you">{y}</b><i>–</i><b className="machine">{m}</b></span>
              <span className="total-meta">{r.length ? `${r.length} played, ${wins} won` : "not played"}</span>
            </button>
          );
        })}
      </div>

      {list.length > 0 && (
        <>
          <div className="chart-head">
            <h2>{GAMES.find((g) => g.key === game).name}: running total</h2>
            {seasons.length > 1 && (
              <select value={shownSeason} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
                {seasons.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                <CartesianGrid stroke="rgba(241,244,236,0.12)" vertical={false} />
                <XAxis dataKey="round" stroke="#9BB3A4" tickLine={false} />
                <YAxis stroke="#9BB3A4" tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0E3A28", border: "1px solid #2E6B4F", color: "#F1F4EC" }}
                  labelFormatter={(r) => `${GAMES.find((g) => g.key === game).round} ${r}`} />
                <Legend />
                <Line type="monotone" dataKey="You" stroke={YOU} strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Machine" stroke={MACHINE} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="results">
            <thead><tr><th>Season</th><th>{GAMES.find((g) => g.key === game).round}</th><th>You</th><th>Machine</th></tr></thead>
            <tbody>
              {list.slice().reverse().map((r) => (
                <tr key={`${r.season}-${r.round}`}>
                  <td>{r.season}</td><td>{r.round}</td>
                  <td className={r.you > r.machine ? "won" : ""}>{r.you}</td>
                  <td className={r.machine > r.you ? "won" : ""}>{r.machine}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="actions">
        <button type="button" className="ghost" onClick={exportData}>Download my results</button>
        <button type="button" className="ghost danger" onClick={reset}>Delete all results</button>
      </div>
    </section>
  );
}
