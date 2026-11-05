// Shared state: the data index plus the season and gameweek being played.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getIndex } from "./lib/data.js";
import { useStored } from "./lib/storage.js";

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [season, setSeasonRaw] = useStored("season", null);
  const [gw, setGw] = useStored("gw", 1);

  useEffect(() => {
    getIndex().then(setIndex).catch((e) => setError(e.message));
  }, []);

  const seasons = index?.seasons ?? [];
  const current = seasons.find((s) => s.season === season) ?? seasons[seasons.length - 1];
  const gameweeks = current?.gameweeks ?? [];

  const value = useMemo(
    () => ({
      index,
      error,
      season: current?.season,
      gameweeks,
      gw: gameweeks.includes(gw) ? gw : gameweeks[0],
      setSeason: (s) => {
        setSeasonRaw(s);
        setGw(1);
      },
      setGw,
      club: (name) => index?.clubs[name] ?? { code: name.slice(0, 3).toUpperCase(), color: "#5c7a6a" },
    }),
    [index, error, current, gameweeks, gw], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export const useGame = () => useContext(GameContext);

/** Fetch something when the inputs change; returns {data, error, loading}. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null, loading: true });
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e) => live && setState({ data: null, error: e.message, loading: false }));
    return () => {
      live = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
