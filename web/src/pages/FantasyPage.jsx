import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import ClubBadge from "../components/ClubBadge.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON, getPool } from "../lib/data.js";
import { matchStats, pointsBreakdown, POSITIONS, RULES, teamPoints, validateSquad } from "../lib/rules.js";
import { eventIcons, fantasyReport } from "../lib/report.js";
import { recordResult, useStored } from "../lib/storage.js";

const BENCH_SIZE = 15 - 11;
const EMPTY = { squad: [], captain: null }; // squad: [{id, xi: true|false}]

// ---------------------------------------------------------------- small pieces
function Shirt({ p, captain, points, icons, onCaptain, onRemove, onToggle, xi, dragging }) {
  return (
    <div className={"shirt" + (captain ? " is-captain" : "") + (dragging ? " is-dragging" : "")}>
      <ClubBadge club={p.club} size="lg" />
      {captain && <span className="armband" title="Captain: double points">C</span>}
      <span className="shirt-name">{p.short}</span>
      {points != null ? (
        <>
          <span className={"shirt-meta pts" + (points < 0 ? " neg" : "")}>{fmt(captain ? points * 2 : points)} pts</span>
          {icons?.length > 0 && (
            <span className="events">
              {icons.map(([icon, label], i) => <span key={i} title={label} aria-label={label}>{icon}</span>)}
            </span>
          )}
        </>
      ) : (
        <span className="shirt-meta">£{p.price.toFixed(1)}m{p.nfix === 0 ? " · no match" : p.nfix > 1 ? " · 2 matches" : ""}</span>
      )}
      {(onCaptain || onRemove) && (
        <span className="shirt-tools">
          {onCaptain && xi && !captain && (
            <button type="button" onClick={onCaptain} aria-label={`Make ${p.name} captain`}>C</button>
          )}
          {onToggle && (
            <button type="button" onClick={onToggle} aria-label={xi ? `Move ${p.name} to the bench` : `Move ${p.name} into the team`}>
              {xi ? "↓" : "↑"}
            </button>
          )}
          {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${p.name}`}>✕</button>}
        </span>
      )}
    </div>
  );
}

function SquadSlot({ p, ...rest }) {
  const drag = useDraggable({ id: `sq-${p.id}`, data: { id: p.id, from: "squad" } });
  const drop = useDroppable({ id: `card-${p.id}`, data: { id: p.id } });
  return (
    <div ref={drop.setNodeRef} className={"slot" + (drop.isOver ? " over" : "")}>
      <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="drag-handle" aria-roledescription="draggable player">
        <Shirt p={p} dragging={drag.isDragging} {...rest} />
      </div>
    </div>
  );
}

function Zone({ id, className, children, label }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className + (isOver ? " over" : "")} aria-label={label}>
      {children}
    </div>
  );
}

function RevealCard({ p, reveal, selected, onSelect, ...rest }) {
  return (
    <div className="slot">
      <button type="button" className={"shirt-btn" + (selected ? " selected" : "")} onClick={() => onSelect(p.id)}
        aria-label={`See how ${p.name} scored`} aria-pressed={selected}>
        <Shirt p={p} icons={eventIcons(reveal, p)} {...rest} />
      </button>
    </div>
  );
}

function Pitch({ starters, bench, captain, editable, points, actions, title, reveal, selected, onSelect }) {
  const rows = POSITIONS.map((pos) => starters.filter((p) => p.pos === pos));
  const emptyBench = Math.max(0, BENCH_SIZE - bench.length);
  const Card = editable ? SquadSlot
    : (props) => <RevealCard reveal={reveal} selected={selected === props.p.id} onSelect={onSelect} {...props} />;
  const body = (
    <>
      {rows.map((row, i) => (
        <div className="pitch-row" key={POSITIONS[i]} data-pos={POSITIONS[i]}>
          {row.map((p) => (
            <Card key={p.id} p={p} xi captain={captain === p.id} points={points?.[p.id] ?? (points ? 0 : null)}
              {...(editable ? actions(p, true) : {})} />
          ))}
          {editable && starters.length < 11 && row.length < RULES.xi[POSITIONS[i]][1] && (
            <div className="slot ghost-slot" aria-hidden="true"><span>{POSITIONS[i]}</span></div>
          )}
        </div>
      ))}
    </>
  );
  return (
    <div className="pitch-wrap">
      {title && <h2 className="pitch-title">{title}</h2>}
      {editable ? <Zone id="pitch" className="pitch" label="Starting 11: drop players here">{body}</Zone> : <div className="pitch">{body}</div>}
      <div className="bench-label">Bench</div>
      {editable ? (
        <Zone id="bench" className="bench" label="Bench: drop players here">
          {bench.map((p) => <SquadSlot key={p.id} p={p} xi={false} {...actions(p, false)} />)}
          {Array.from({ length: emptyBench }, (_, i) => <div key={i} className="slot ghost-slot" aria-hidden="true"><span>Sub</span></div>)}
        </Zone>
      ) : (
        <div className="bench">
          {bench.map((p) => <Card key={p.id} p={p} xi={false} points={points?.[p.id] ?? 0} />)}
        </div>
      )}
    </div>
  );
}

function PoolCard({ p, inSquad, onAdd }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `pool-${p.id}`, data: { id: p.id, from: "pool" }, disabled: inSquad });
  return (
    <li className={"pool-card" + (inSquad ? " taken" : "") + (isDragging ? " is-dragging" : "")}>
      <div ref={setNodeRef} {...listeners} {...attributes} className="pool-grab" aria-roledescription="draggable player">
        <ClubBadge club={p.club} />
        <span className="pool-name">
          <b>{p.short}</b>
          <small>{p.pos} · {p.club}{p.nfix === 0 ? " · no match" : p.nfix > 1 ? " · 2 matches" : ""}</small>
        </span>
        <span className="pool-num">£{p.price.toFixed(1)}</span>
        <span className="pool-num form" title="Average points over their last 5 gameweeks">{p.form ?? "–"}</span>
      </div>
      <button type="button" className="add" onClick={() => onAdd(p.id)} disabled={inSquad} aria-label={`Add ${p.name}`}>
        {inSquad ? "✓" : "+"}
      </button>
    </li>
  );
}

const fmt = (n) => (n < 0 ? `−${-n}` : String(n)); // proper minus sign

function Breakdown({ player, rev, season, captainFor, onClose }) {
  const matches = matchStats(rev, player.id);
  const total = rev.points[player.id] ?? 0;
  return (
    <aside className="breakdown" aria-live="polite" aria-label={`How ${player.name} scored`}>
      <header>
        <ClubBadge club={player.club} />
        <div>
          <h3>{player.name}</h3>
          <p>{player.pos} · {player.club}</p>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      {matches.length === 0 && (
        <p className="bd-note">{player.nfix === 0 ? `${player.club} had no match this gameweek.` : "Didn't play this gameweek, so no points."}</p>
      )}
      {matches.map((m, i) => {
        const res = m.for > m.against ? "won" : m.for < m.against ? "lost" : "drew";
        return (
          <div key={i} className="bd-match">
            <p className="bd-fixture">vs {m.opp} ({m.home ? "home" : "away"}), {res} {m.for}–{m.against}</p>
            <ul>
              {pointsBreakdown(player.pos, m, season).map((l, j) => (
                <li key={j} className={l.pts < 0 ? "neg" : l.pts > 0 ? "pos" : ""}>
                  <span>{l.label}</span>
                  <b>{l.pts > 0 ? `+${l.pts}` : l.pts < 0 ? `−${-l.pts}` : "0"}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="bd-total">
        <span>Total</span>
        <b>{fmt(total)} pts</b>
      </p>
      {captainFor.length > 0 && (
        <p className="bd-note">Captain for {captainFor.join(" and ")}, so it counts double: {fmt(total * 2)} pts.</p>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- page
export default function FantasyPage() {
  const { season, gw } = useGame();
  const key = `${season}:${gw}`;
  const [team, setTeam] = useStored(`fantasy:${key}`, EMPTY);
  const [revealed, setRevealed] = useStored(`fantasy-revealed:${key}`, false);
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState({ q: "", pos: "ALL", club: "ALL", maxPrice: 15 });
  const [activeId, setActiveId] = useState(null);
  const [selected, setSelected] = useState(null); // player whose points breakdown is open

  const pool = useLoad(() => getPool(season, gw), [season, gw]);
  const reveal = useLoad(() => (revealed ? getJSON(`${season}/fantasy/${gw}.reveal.json`) : Promise.resolve(null)), [season, gw, revealed]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byId = useMemo(() => Object.fromEntries((pool.data ?? []).map((p) => [p.id, p])), [pool.data]);
  const clubs = useMemo(() => [...new Set((pool.data ?? []).map((p) => p.club))].sort(), [pool.data]);

  if (!season) return <p className="notice">Loading…</p>;
  if (pool.error) return <p className="notice error">{pool.error}</p>;
  if (pool.loading) return <p className="notice">Loading players for gameweek {gw}…</p>;

  const squad = team.squad.filter((s) => byId[s.id]);
  const ids = squad.map((s) => s.id);
  const xiIds = squad.filter((s) => s.xi).map((s) => s.id);
  const starters = xiIds.map((id) => byId[id]);
  const bench = squad.filter((s) => !s.xi).map((s) => byId[s.id]);
  const count = (list, pos) => list.filter((p) => p.pos === pos).length;
  const squadPlayers = ids.map((id) => byId[id]);
  const spent = squadPlayers.reduce((s, p) => s + p.price, 0);
  const clubCount = {};
  squadPlayers.forEach((p) => (clubCount[p.club] = (clubCount[p.club] || 0) + 1));
  const problems = validateSquad(byId, ids, xiIds, team.captain);

  const canStart = (p, startersNow = starters) =>
    startersNow.length < 11 && count(startersNow, p.pos) < RULES.xi[p.pos][1];

  // ---- squad edits
  const add = (id, wantXi = true) => {
    const p = byId[id];
    if (ids.includes(id)) return;
    if (count(squadPlayers, p.pos) >= RULES.squad[p.pos]) {
      setMessage(`You already have ${RULES.squad[p.pos]} ${p.pos}. Remove one first.`);
      return;
    }
    let xi = wantXi && canStart(p);
    if (!xi && bench.length >= BENCH_SIZE) xi = canStart(p);
    if (!xi && bench.length >= BENCH_SIZE) {
      setMessage(`No room for ${p.short}: the bench is full and the starting 11 can't take another ${p.pos}.`);
      return;
    }
    setMessage(null);
    setTeam((t) => ({ ...t, squad: [...t.squad, { id, xi }] }));
  };
  const remove = (id) => setTeam((t) => ({ squad: t.squad.filter((s) => s.id !== id), captain: t.captain === id ? null : t.captain }));
  const setXi = (id, xi) => {
    const p = byId[id];
    if (xi && !canStart(p)) {
      setMessage(starters.length >= 11 ? "Your starting 11 is full. Drop a bench player onto a starter to swap them." : `You can't start more than ${RULES.xi[p.pos][1]} ${p.pos}.`);
      return;
    }
    if (!xi && bench.length >= BENCH_SIZE) {
      setMessage("The bench is full. Drop this player onto a bench player to swap them.");
      return;
    }
    setMessage(null);
    setTeam((t) => ({ squad: t.squad.map((s) => (s.id === id ? { ...s, xi } : s)), captain: !xi && t.captain === id ? null : t.captain }));
  };
  const swap = (a, b) => {
    const sa = squad.find((s) => s.id === a);
    const sb = squad.find((s) => s.id === b);
    if (!sa || !sb || sa.xi === sb.xi) return;
    const after = starters.filter((p) => p.id !== (sa.xi ? a : b)).concat(byId[sa.xi ? b : a]);
    const bad = POSITIONS.find((pos) => count(after, pos) < RULES.xi[pos][0] || count(after, pos) > RULES.xi[pos][1]);
    if (bad) {
      setMessage(`That swap would leave the starting 11 with ${count(after, bad)} ${bad}. Allowed: ${RULES.xi[bad][0]}–${RULES.xi[bad][1]}.`);
      return;
    }
    setMessage(null);
    setTeam((t) => ({
      squad: t.squad.map((s) => (s.id === a ? { ...s, xi: sb.xi } : s.id === b ? { ...s, xi: sa.xi } : s)),
      captain: [a, b].includes(t.captain) ? null : t.captain,
    }));
  };
  const replace = (outId, inId) => {
    const out = byId[outId];
    const inn = byId[inId];
    if (out.pos !== inn.pos) {
      add(inId);
      return;
    }
    setMessage(null);
    setTeam((t) => ({
      squad: t.squad.map((s) => (s.id === outId ? { id: inId, xi: s.xi } : s)),
      captain: t.captain === outId ? null : t.captain,
    }));
  };

  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    const { id, from } = active.data.current;
    const target = String(over.id);
    if (from === "pool") {
      if (target === "pitch") add(id, true);
      else if (target === "bench") add(id, false);
      else if (target.startsWith("card-")) replace(over.data.current.id, id);
    } else {
      if (target === "pool") remove(id);
      else if (target === "pitch") setXi(id, true);
      else if (target === "bench") setXi(id, false);
      else if (target.startsWith("card-") && over.data.current.id !== id) swap(id, over.data.current.id);
    }
  };

  const actions = (p, xi) => ({
    onCaptain: () => setTeam((t) => ({ ...t, captain: p.id })),
    onRemove: () => remove(p.id),
    onToggle: () => setXi(p.id, !xi),
  });

  const doReveal = async () => {
    const rev = await getJSON(`${season}/fantasy/${gw}.reveal.json`);
    recordResult("fantasy", season, gw, teamPoints(rev.points, xiIds, team.captain), rev.machine.total);
    setRevealed(true);
  };

  // ---- revealed view
  if (revealed && reveal.data) {
    const rev = reveal.data;
    const you = teamPoints(rev.points, xiIds, team.captain);
    const m = rev.machine;
    const mStarters = m.xi.map((id) => byId[id]).filter(Boolean);
    const mBench = m.squad.filter((id) => !m.xi.includes(id)).map((id) => byId[id]).filter(Boolean);
    const tops = rev.topScorers.map((id) => byId[id]?.name).filter(Boolean).join(", ");
    const report = fantasyReport({
      rev, byId, season,
      you: { xi: xiIds, captain: team.captain, total: you },
      machine: { xi: m.xi, captain: m.captain, total: m.total },
    });
    const sel = selected != null ? byId[selected] : null;
    const captainFor = [team.captain === selected && "you", m.captain === selected && "the machine"].filter(Boolean);
    return (
      <section>
        <div className="page-head">
          <h1>Gameweek {gw} fantasy</h1>
          <p className="lede">Real FPL points for each starter. Captains count double and the bench doesn't score.</p>
        </div>
        <div className="scoreline-banner reveal-in" aria-live="polite">
          <div><span className="who">You</span><span className="big">{you}</span></div>
          <span className="dash">–</span>
          <div><span className="big">{m.total}</span><span className="who">Machine</span></div>
          <p className="verdict">Top scorer this week: {tops} with {rev.topPoints} points.</p>
        </div>
        <section className="report" aria-label="Match report">
          <h2>Why it ended {you}–{m.total}</h2>
          <ul>{report.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <p className="hint">Tap any player to see exactly how they scored.</p>
        </section>
        <div className="two-pitches">
          <Pitch title="Your team" starters={starters} bench={bench} captain={team.captain} points={rev.points}
            reveal={rev} selected={selected} onSelect={setSelected} />
          <Pitch title="Machine's team" starters={mStarters} bench={mBench} captain={m.captain} points={rev.points}
            reveal={rev} selected={selected} onSelect={setSelected} />
        </div>
        {sel && <Breakdown player={sel} rev={rev} season={season} captainFor={captainFor} onClose={() => setSelected(null)} />}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => { setSelected(null); setRevealed(false); }}>Change my team</button>
        </div>
      </section>
    );
  }

  // ---- building view
  const f = filters;
  const q = f.q.trim().toLowerCase();
  const visible = (pool.data ?? [])
    .filter((p) => (f.pos === "ALL" || p.pos === f.pos) && (f.club === "ALL" || p.club === f.club) && p.price <= f.maxPrice)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.short.toLowerCase().includes(q))
    .sort((a, b) => (b.form ?? -1) - (a.form ?? -1) || b.price - a.price)
    .slice(0, 80);
  const overClubs = Object.entries(clubCount).filter(([, n]) => n > RULES.maxPerClub);
  const activePlayer = activeId ? byId[activeId] : null;

  return (
    <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(active.data.current.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <section>
        <div className="page-head">
          <h1>Gameweek {gw} fantasy</h1>
          <p className="lede">
            Drag players onto the pitch or bench. Drop a sub onto a starter to swap them, and tap C to pick your captain.
          </p>
        </div>

        <div className="rules-bar" aria-live="polite">
          <div className={"budget" + (spent > RULES.budget + 1e-9 ? " over" : "")}>
            <span>£{spent.toFixed(1)}m of £{RULES.budget}m</span>
            <div className="budget-track"><div style={{ width: `${Math.min(100, spent)}%` }} /></div>
          </div>
          <div className="counts">
            {POSITIONS.map((pos) => (
              <span key={pos} className={count(squadPlayers, pos) === RULES.squad[pos] ? "full" : ""}>
                {pos} {count(squadPlayers, pos)}/{RULES.squad[pos]}
              </span>
            ))}
            <span className={starters.length === 11 ? "full" : ""}>Starting {starters.length}/11</span>
          </div>
          {overClubs.length > 0 && <p className="warn">Too many from {overClubs.map(([c, n]) => `${c} (${n})`).join(", ")}. The limit is 3 per club.</p>}
          {message && <p className="warn" role="status">{message}</p>}
        </div>

        <div className="builder">
          <Pitch editable starters={starters} bench={bench} captain={team.captain} actions={actions} />

          <Zone id="pool" className="pool" label="Player list: drop a squad player here to remove them">
            <div className="filters">
              <input type="search" placeholder="Search players" value={f.q} onChange={(e) => setFilters({ ...f, q: e.target.value })} aria-label="Search players" />
              <div className="pos-chips" role="group" aria-label="Position">
                {["ALL", ...POSITIONS].map((pos) => (
                  <button key={pos} type="button" className={f.pos === pos ? "on" : ""} onClick={() => setFilters({ ...f, pos })}>
                    {pos === "ALL" ? "All" : pos}
                  </button>
                ))}
              </div>
              <div className="filter-row">
                <select value={f.club} onChange={(e) => setFilters({ ...f, club: e.target.value })} aria-label="Club">
                  <option value="ALL">All clubs</option>
                  {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="price-filter">
                  Up to £{f.maxPrice.toFixed(1)}m
                  <input type="range" min="4" max="15" step="0.5" value={f.maxPrice} onChange={(e) => setFilters({ ...f, maxPrice: Number(e.target.value) })} />
                </label>
              </div>
            </div>
            <div className="pool-head"><span>Player</span><span>Price</span><span title="Average points over their last 5 gameweeks">Form</span></div>
            <ul className="pool-list">
              {visible.map((p) => <PoolCard key={p.id} p={p} inSquad={ids.includes(p.id)} onAdd={(id) => add(id, true)} />)}
              {visible.length === 0 && <li className="empty">No players match. Try a different filter.</li>}
            </ul>
          </Zone>
        </div>

        <div className="actions sticky-actions">
          {squad.length > 0 && (
            <button type="button" className="ghost" onClick={() => { setTeam(EMPTY); setMessage(null); }}>Clear team</button>
          )}
          <span className="count">{problems.length ? problems[0] : "Your team is ready."}</span>
          <button type="button" className="primary" disabled={problems.length > 0} onClick={doReveal}>Reveal points</button>
        </div>
      </section>
      <DragOverlay dropAnimation={null}>
        {activePlayer ? <div className="overlay"><Shirt p={activePlayer} /></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
