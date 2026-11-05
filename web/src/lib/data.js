// Loads the JSON exported by scripts/export_web_data.py (in public/data).
const cache = new Map();

export function getJSON(path) {
  if (!cache.has(path)) {
    const p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status}). Run scripts/export_web_data.py to create the data.`);
      return r.json();
    });
    p.catch(() => cache.delete(path)); // allow a retry after a failure
    cache.set(path, p);
  }
  return cache.get(path);
}

export const getIndex = () => getJSON("index.json");

/** Turn {cols, rows} into a list of objects. */
export function table({ cols, rows }) {
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

/** Player pool for a gameweek, with names joined in. */
export async function getPool(season, gw) {
  const [pool, names] = await Promise.all([getJSON(`${season}/fantasy/${gw}.json`), getJSON(`${season}/players.json`)]);
  return table(pool).map((p) => ({ ...p, name: names[p.id]?.[0] ?? `#${p.id}`, short: names[p.id]?.[1] ?? `#${p.id}` }));
}

export async function getPlayerNames(season) {
  return getJSON(`${season}/players.json`);
}
