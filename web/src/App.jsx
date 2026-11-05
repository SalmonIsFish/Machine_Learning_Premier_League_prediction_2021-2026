import { Component, lazy, Suspense } from "react";

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
        <button type="button" className="ghost" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { GameProvider, useGame } from "./game.jsx";
import ScorePage from "./pages/ScorePage.jsx";
import FantasyPage from "./pages/FantasyPage.jsx";
import AwardsPage from "./pages/AwardsPage.jsx";

const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage.jsx")); // charts library loads only here

const TABS = [
  { to: "/score", label: "Score predictor" },
  { to: "/fantasy", label: "Fantasy" },
  { to: "/awards", label: "Awards" },
  { to: "/leaderboard", label: "Leaderboard" },
];

function SeasonPicker() {
  const { index, season, setSeason, gw, setGw, gameweeks } = useGame();
  const { pathname } = useLocation();
  const showGw = pathname === "/score" || pathname === "/fantasy";
  if (!index) return null;
  const i = gameweeks.indexOf(gw);
  return (
    <div className="picker">
      <label>
        <span className="sr-only">Season</span>
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          {index.seasons.map((s) => (
            <option key={s.season} value={s.season}>{s.season}</option>
          ))}
        </select>
      </label>
      {showGw && (
        <div className="gw-stepper" role="group" aria-label="Gameweek">
          <button type="button" onClick={() => setGw(gameweeks[i - 1])} disabled={i <= 0} aria-label="Previous gameweek">‹</button>
          <select value={gw} onChange={(e) => setGw(Number(e.target.value))} aria-label="Gameweek">
            {gameweeks.map((g) => (
              <option key={g} value={g}>Gameweek {g}</option>
            ))}
          </select>
          <button type="button" onClick={() => setGw(gameweeks[i + 1])} disabled={i >= gameweeks.length - 1} aria-label="Next gameweek">›</button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { error } = useGame();
  const { pathname } = useLocation();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/score" className="brand">
          <span className="brand-you">You</span>
          <span className="brand-vs">vs</span>
          <span className="brand-machine">the Machine</span>
        </NavLink>
        <nav className="tabs" aria-label="Games">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <SeasonPicker />
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
