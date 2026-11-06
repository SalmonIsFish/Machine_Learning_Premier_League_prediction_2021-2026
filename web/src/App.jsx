import { Component, lazy, Suspense } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { GwStepper } from "./components/Scoreboard.jsx";
import SoundToggle from "./components/SoundToggle.jsx";
import { GameProvider, useGame } from "./game.jsx";
import AwardsPage from "./pages/AwardsPage.jsx";
import FantasyPage from "./pages/FantasyPage.jsx";
import ScorePage from "./pages/ScorePage.jsx";

const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage.jsx")); // charts library loads only here

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error">
        <p>This page hit an error: {String(this.state.error.message || this.state.error)}</p>
        <button type="button" className="btn btn-ghost" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

const TABS = [
  { to: "/score", label: "Score predictor", short: "Scores" },
  { to: "/fantasy", label: "Fantasy", short: "Fantasy" },
  { to: "/awards", label: "Awards", short: "Awards" },
  { to: "/leaderboard", label: "Leaderboard", short: "Table" },
];

function SeasonPicker() {
  const { index, season, setSeason, gw, setGw, gameweeks } = useGame();
  const { pathname } = useLocation();
  if (!index) return null;
  return (
    <div className="picker">
      <select className="season" value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
        {index.seasons.map((s) => <option key={s.season} value={s.season}>{s.season}</option>)}
      </select>
      {(pathname === "/score" || pathname === "/fantasy") && (
        <GwStepper value={gw} options={gameweeks} onChange={setGw} label="Gameweek" />
      )}
    </div>
  );
}

function Shell() {
  const { error } = useGame();
  const { pathname } = useLocation();
  return (
    <div className="app">
      <img className="stadium" src="/stadium.svg" alt="" aria-hidden="true" />
      <header className="topbar">
        <NavLink to="/score" className="brand">
          <span className="you">You</span>
          <small>vs</small>
          <span className="machine">the Machine</span>
        </NavLink>
        <nav className="tabs" aria-label="Games">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
              <span className="tab-long">{t.label}</span>
              <span className="tab-short">{t.short}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <SeasonPicker />
          <SoundToggle />
        </div>
      </header>
      <main className="page">
        {error ? (
          <p className="notice error">{error}</p>
        ) : (
          <ErrorBoundary key={pathname}>
            <Routes>
              <Route path="/" element={<Navigate to="/score" replace />} />
              <Route path="/score" element={<ScorePage />} />
              <Route path="/fantasy" element={<FantasyPage />} />
              <Route path="/awards" element={<AwardsPage />} />
              <Route path="/leaderboard" element={<Suspense fallback={<p className="notice">Loading…</p>}><LeaderboardPage /></Suspense>} />
              <Route path="*" element={<Navigate to="/score" replace />} />
            </Routes>
          </ErrorBoundary>
        )}
      </main>
      <footer className="footer">
        Replays real Premier League seasons. The machine only learns from seasons before the one you play. Data:{" "}
        <a href="https://www.football-data.co.uk/">football-data.co.uk</a> and{" "}
        <a href="https://github.com/vaastav/Fantasy-Premier-League">vaastav/Fantasy-Premier-League</a>.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
