// Saves picks and results in this browser. Every access is guarded: storage can be blocked (private mode).
import { useEffect, useState } from "react";

const PREFIX = "pl-game:";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the game still works, it just won't remember */
  }
  window.dispatchEvent(new CustomEvent("pl-storage", { detail: key }));
}

/** useState that is remembered in localStorage under `key` (re-reads when the key changes). */
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => load(key, fallback));
  useEffect(() => setValue(load(key, fallback)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (v) => {
    setValue((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      save(key, next);
      return next;
    });
  };
  return [value, update];
}

// ---- results log used by the leaderboard
// results = { score: {"2025-26|1": {you, machine}}, fantasy: {...}, awards: {"2025-26|19": {...}}, potw: {...} }
export function recordResult(game, season, round, you, machine) {
  const all = load("results", {});
  all[game] = { ...(all[game] || {}), [`${season}|${round}`]: { you, machine, at: Date.now() } };
  save("results", all);
}

export function loadResults() {
  return load("results", {});
}

export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("pl-storage", { detail: "*" }));
}
