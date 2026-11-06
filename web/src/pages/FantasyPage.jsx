import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import Celebration, { outcome } from "../components/Celebration.jsx";
import Jersey from "../components/Jersey.jsx";
import PlayerCard, { tierForPrice } from "../components/PlayerCard.jsx";
import { GiantScoreboard } from "../components/Scoreboard.jsx";
import { useGame, useLoad } from "../game.jsx";
import { getJSON, getPool } from "../lib/data.js";
import { eventIcons, fantasyReport } from "../lib/report.js";
import { matchStats, pointsBreakdown, POSITIONS, RULES, teamPoints, validateSquad } from "../lib/rules.js";
import { play, playFullTime } from "../lib/sound.js";
import { recordResult, useStored } from "../lib/storage.js";

const BENCH_SIZE = 15 - 11;
const EMPTY = { squad: [], captain: null }; // squad: [{id, xi: true|false}]
const fmt = (n) => (n < 0 ? `−${-n}` : String(n)); // proper minus sign

// ---------------------------------------------------------------- pitch artwork
const PITCH_ART = (() => {
  const W = 640;
  const H = 600;
  const xAt = (t) => {
    const w = 450 + 170 * t;
    return [(W - w) / 2, (W + w) / 2];
  };
  const yAt = (t) => 20 + (H - 40) * t ** 1.15;
  const stripes = Array.from({ length: 10 }, (_, i) => {
    const [a0, b0] = xAt(i / 10);
    const [a1, b1] = xAt((i + 1) / 10);
    return { d: `M${a0} ${yAt(i / 10)}L${b0} ${yAt(i / 10)}L${b1} ${yAt((i + 1) / 10)}L${a1} ${yAt((i + 1) / 10)}Z`, fill: i % 2 ? "#1C7F46" : "#23924F" };
  });
  const [ta, tb] = xAt(0);
  const [ba, bb] = xAt(1);
  const [ma, mb] = xAt(0.5);
  return { W, H, stripes, outline: `M${ta} 20L${tb} 20L${bb} ${H - 20}L${ba} ${H - 20}Z`, midY: yAt(0.5), ma, mb };
})();

function PitchArt() {
  const { W, H, stripes, outline, midY, ma, mb } = PITCH_ART;
  const line = { stroke: "#F2F7FF", strokeOpacity: 0.8, strokeWidth: 2.5, fill: "none" };
  return (
    <svg className="pitch-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="pitch-glow" cx=".5" cy=".35" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#060B16" stopOpacity=".38" />
        </radialGradient>
      </defs>
      {stripes.map((s) => <path key={s.d} d={s.d} fill={s.fill} />)}
      <path d={outline} {...line} />
      <path d={`M${ma} ${midY}L${mb} ${midY}`} {...line} />
      <ellipse cx="320" cy={midY} rx="64" ry="52" {...line} />
      <path d="M196 20L208 98L432 98L444 20" {...line} />
      <path d={`M162 ${H - 20}L176 ${H - 118}L464 ${H - 118}L478 ${H - 20}`} {...line} />
      <path d={outline} fill="url(#pitch-glow)" />
    </svg>
  );
}

// ---------------------------------------------------------------- player on the pitch
function Token({ p, captain, points, icons, tools, flip, flipDelay }) {
  const shown = captain ? points * 2 : points;
  return (
    <div className={"token" + (captain ? " is-captain" : "") + (flip ? " flip" : "")} style={flip ? { animationDelay: `${flipDelay}ms` } : undefined}>
      <Jersey club={p.club} size={54} />
      {captain && <span className="armband" title="Captain: double points">C</span>}
      <span className="token-name" title={p.name}>{p.short}</span>
      {points != null ? (
        <span className={"token-meta pts" + (captain ? " cap" : "") + (points < 0 ? " neg" : "")}>{fmt(shown)}</span>
      ) : (
        <span className="token-meta">£{p.price.toFixed(1)}m</span>
      )}
      {icons?.length > 0 && (
        <span className="events">{icons.map(([icon, label], i) => <span key={i} title={label} aria-label={label}>{icon}</span>)}</span>
      )}
      {tools}
    </div>
  );
}

function Tools({ p, xi, captain, onCaptain, onToggle, onRemove }) {
  return (
    <span className="token-tools">
      {xi && !captain && <button type="button" onClick={onCaptain} aria-label={`Make ${p.name} captain`} title="Make captain">C</button>}
      <button type="button" onClick={onToggle} aria-label={xi ? `Move ${p.name} to the bench` : `Move ${p.name} into the team`} title={xi ? "Move to bench" : "Move into team"}>{xi ? "↓" : "↑"}</button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${p.name}`} title="Remove">✕</button>
    </span>
  );
}

function SquadSlot({ p, xi, captain, actions, open, onTap }) {
  const drag = useDraggable({ id: `sq-${p.id}`, data: { id: p.id, from: "squad" } });
  const drop = useDroppable({ id: `card-${p.id}`, data: { id: p.id } });
  return (
    <div ref={drop.setNodeRef} onClick={() => onTap(p.id)} className={"slot" + (drop.isOver ? " over" : "") + (drag.isDragging ? " lifting" : "") + (open ? " open" : "")}>
      <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="grab" aria-roledescription="draggable player">
        <Token p={p} captain={captain} tools={<Tools p={p} xi={xi} captain={captain} {...actions(p, xi)} />} />
      </div>
    </div>
  );
}

function Zone({ id, className, children, label }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={className + (isOver ? " over" : "")} aria-label={label}>{children}</div>;
}

const GhostSlot = ({ label, glow }) => <div className={"ghost-slot" + (glow ? " glow" : "")} aria-hidden="true"><span>{label}</span></div>;

/** The team being built: draggable players, empty slots and the bench. */
function EditablePitch({ starters, bench, captain, actions, dragPos }) {
  const [openId, setOpenId] = useState(null); // the player showing captain/bench/remove buttons (touch screens)
  const onTap = (id) => setOpenId((cur) => (cur === id ? null : id));
  const emptyBench = Math.max(0, BENCH_SIZE - bench.length);
  return (
    <div className="pitch-col">
      <Zone id="pitch" className="pitch" label="Starting 11: drop players here">
        <PitchArt />
        {POSITIONS.map((pos) => {
          const row = starters.filter((p) => p.pos === pos);
          return (
            <div className="pitch-row" key={pos}>
              {row.map((p) => <SquadSlot key={p.id} p={p} xi captain={captain === p.id} actions={actions} open={openId === p.id} onTap={onTap} />)}
              {starters.length < 11 && row.length < RULES.xi[pos][1] && <GhostSlot label={pos} glow={dragPos === pos} />}
            </div>
          );
        })}
      </Zone>
      <div className="bench-box">
        <h2>Subs' bench</h2>
        <Zone id="bench" className="bench" label="Bench: drop players here">
          {bench.map((p) => <SquadSlot key={p.id} p={p} xi={false} captain={false} actions={actions} open={openId === p.id} onTap={onTap} />)}
          {Array.from({ length: emptyBench }, (_, i) => <GhostSlot key={i} label="Sub" glow={!!dragPos} />)}
        </Zone>
      </div>
    </div>
  );
}

/** A finished team: tap a player to see how they scored. */
function RevealPitch({ title, tone, starters, bench, captain, rev, selected, onSelect, flip }) {
  const card = (p, i) => (
    <button key={p.id} type="button" className={"token-btn" + (selected === p.id ? " selected" : "")} onClick={() => onSelect(p.id)}
      aria-label={`See how ${p.name} scored`} aria-pressed={selected === p.id}>
      <Token p={p} captain={captain === p.id} points={rev.points[p.id] ?? 0} icons={eventIcons(rev, p)} flip={flip} flipDelay={i * 70} />
    </button>
  );
  let i = 0;
  return (
    <div className="pitch-col">
      <h2 className={`team-title ${tone}`}>{title}</h2>
      <div className="pitch">
        <PitchArt />
        {POSITIONS.map((pos) => (
          <div className="pitch-row" key={pos}>{starters.filter((p) => p.pos === pos).map((p) => card(p, i++))}</div>
        ))}
      </div>
      <div className="bench-box">
        <h2>Bench <small>doesn't score</small></h2>
        <div className="bench">{bench.map((p) => card(p, i++))}</div>
      </div>
    </div>
  );
}

function MarketCard({ p, inSquad, onAdd }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `pool-${p.id}`, data: { id: p.id, from: "pool" }, disabled: inSquad });
  return (
    <li className={"market-item" + (isDragging ? " lifting" : "")}>
      <div ref={setNodeRef} {...listeners} {...attributes} className="grab" aria-roledescription="draggable player">
        <PlayerCard name={p.short} pos={p.pos} club={p.club} value={p.form ?? "–"} foot={`£${p.price.toFixed(1)}m`} tier={tierForPrice(p.price)} faded={inSquad}>
          {p.nfix !== 1 && <span className="pcard-flag">{p.nfix === 0 ? "No match" : `${p.nfix} matches`}</span>}
        </PlayerCard>
      </div>
      <button type="button" className={"card-add" + (inSquad ? " done" : "")} onClick={() => onAdd(p.id)} disabled={inSquad} aria-label={inSquad ? `${p.name} is in your squad` : `Add ${p.name}`}>
        {inSquad ? "✓" : "+"}
      </button>
    </li>
  );
}

function Breakdown({ player, rev, season, captainFor, onClose }) {
  const matches = matchStats(rev, player.id);
  const total = rev.points[player.id] ?? 0;
  return (
    <aside className="breakdown" aria-live="polite" aria-label={`How ${player.name} scored`}>
      <header>
        <Jersey club={player.club} size={44} />
        <div>
          <h3>{player.name}</h3>
          <p>{player.pos}, {player.club}</p>
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
            <p className="bd-fixture">{m.home ? "Home to" : "Away at"} {m.opp}, {res} {m.for}–{m.against}</p>
            <ul>
              {pointsBreakdown(player.pos, m, season).map((l, j) => (
                <li key={j} className={l.pts < 0 ? "neg" : l.pts > 0 ? "pos" : ""}>
                  <span>{l.label}</span>
                  <b>{l.pts > 0 ? `+${l.pts}` : fmt(l.pts)}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="bd-total"><span>Total</span><b>{fmt(total)} pts</b></p>
      {captainFor.length > 0 && <p className="bd-note">Captain for {captainFor.join(" and ")}, so it counts double: {fmt(total * 2)} pts.</p>}
    </aside>
  );
}

// ---------------------------------------------------------------- page
export default function FantasyPage() {
  const { season, gw, gameweeks, setGw } = useGame();
  const key = `${season}:${gw}`;
  const [team, setTeam] = useStored(`fantasy:${key}`, EMPTY);
  const [revealed, setRevealed] = useStored(`fantasy-revealed:${key}`, false);
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState({ q: "", pos: "ALL", club: "ALL", maxPrice: 16 });
  const [active, setActive] = useState(null); // {id, from} while dragging
  const [selected, setSelected] = useState(null); // player whose points breakdown is open
  const [justRevealed, setJustRevealed] = useState(false);

  const pool = useLoad(() => getPool(season, gw), [season, gw]);
  const reveal = useLoad(() => (revealed ? getJSON(`${season}/fantasy/${gw}.reveal.json`) : Promise.resolve(null)), [season, gw, revealed]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    setJustRevealed(false);
    setSelected(null);
    setMessage(null);
  }, [key]);

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
    play("click");
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
    play("click");
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
    play("click");
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
    play("click");
    setTeam((t) => ({
      squad: t.squad.map((s) => (s.id === outId ? { id: inId, xi: s.xi } : s)),
      captain: t.captain === outId ? null : t.captain,
    }));
  };

  const onDragEnd = ({ active: dragged, over }) => {
    setActive(null);
    if (!over) return;
    const { id, from } = dragged.data.current;
    const target = String(over.id);
    if (from === "pool") {
      if (target === "pitch") add(id, true);
      else if (target === "bench") add(id, false);
      else if (target.startsWith("card-")) replace(over.data.current.id, id);
    } else if (target === "pool") remove(id);
    else if (target === "pitch") setXi(id, true);
    else if (target === "bench") setXi(id, false);
    else if (target.startsWith("card-") && over.data.current.id !== id) swap(id, over.data.current.id);
  };

  const actions = (p, xi) => ({
    onCaptain: () => setTeam((t) => ({ ...t, captain: p.id })),
    onRemove: () => remove(p.id),
    onToggle: () => setXi(p.id, !xi),
  });

  const doReveal = async () => {
    const rev = await getJSON(`${season}/fantasy/${gw}.reveal.json`);
    const you = teamPoints(rev.points, xiIds, team.captain);
    recordResult("fantasy", season, gw, you, rev.machine.total);
    playFullTime(outcome(you, rev.machine.total));
    setJustRevealed(true);
    setRevealed(true);
  };

  // ---- revealed view
  if (revealed && reveal.data) {
    const rev = reveal.data;
    const you = teamPoints(rev.points, xiIds, team.captain);
    const m = rev.machine;
    const mStarters = m.xi.map((id) => byId[id]).filter(Boolean);
    const mBench = m.squad.filter((id) => !m.xi.includes(id)).map((id) => byId[id]).filter(Boolean);
    const report = fantasyReport({
      rev, byId, season,
      you: { xi: xiIds, captain: team.captain, total: you },
      machine: { xi: m.xi, captain: m.captain, total: m.total },
    });
    const sel = selected != null ? byId[selected] : null;
    const captainFor = [team.captain === selected && "you", m.captain === selected && "the machine"].filter(Boolean);
    const star = byId[rev.topScorers[0]];
    const nextGw = gameweeks[gameweeks.indexOf(gw) + 1];
    return (
      <section>
        {justRevealed && <Celebration result={outcome(you, m.total)} />}
        <GiantScoreboard title="Full time" you={you} machine={m.total} roll={justRevealed} />
        <div className="report-row">
          <section className="panel report" aria-label="Match report">
            <h2>Why it ended {you}–{m.total}</h2>
            <ul>{report.map((line, i) => <li key={i}>{line}</li>)}</ul>
            <p className="report-hint">Tap any player to see exactly how they scored.</p>
          </section>
          {star && (
            <div className="star-week">
              <h2>Star of the week</h2>
              <PlayerCard name={star.short} pos={star.pos} club={star.club} value={`${rev.topPoints} pts`} foot={`£${star.price.toFixed(1)}m`} tier="star" />
              {rev.topScorers.length > 1 && <p>Tied with {rev.topScorers.length - 1} more</p>}
            </div>
          )}
        </div>
        <div className="two-pitches">
          <RevealPitch title="Your team" tone="you" starters={starters} bench={bench} captain={team.captain} rev={rev} selected={selected} onSelect={setSelected} flip={justRevealed} />
          <RevealPitch title="Machine's team" tone="machine" starters={mStarters} bench={mBench} captain={m.captain} rev={rev} selected={selected} onSelect={setSelected} flip={justRevealed} />
        </div>
        {sel && <Breakdown player={sel} rev={rev} season={season} captainFor={captainFor} onClose={() => setSelected(null)} />}
        <div className="action-bar">
          <button type="button" className="btn btn-ghost" onClick={() => { setSelected(null); setRevealed(false); }}>Change my team</button>
          {nextGw && <button type="button" className="btn btn-primary" onClick={() => setGw(nextGw)}>Go to gameweek {nextGw}</button>}
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
    .slice(0, 60);
  const overClubs = Object.entries(clubCount).filter(([, n]) => n > RULES.maxPerClub);
  const dragged = active ? byId[active.id] : null;
  const left = RULES.budget - spent;

  return (
    <DndContext sensors={sensors} onDragStart={({ active: a }) => setActive(a.data.current)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <section>
        <div className="builder-head">
          <div className="builder-title">
            <h1>Pick your XI</h1>
            <p>Drag player cards onto the pitch. Drop a sub on a starter to swap. Tap a player on the pitch, then C, to make them captain.</p>
          </div>
          <div className="rules-board" aria-live="polite">
            <div className={"rb-budget" + (left < -1e-9 ? " over" : "")}>
              <span>Budget left</span>
              <b>{left < 0 ? "−" : ""}£{Math.abs(left).toFixed(1)}m</b>
              <div className="rb-track"><div style={{ width: `${Math.min(100, spent)}%` }} /></div>
            </div>
            {POSITIONS.map((pos) => (
              <div key={pos} className={count(squadPlayers, pos) === RULES.squad[pos] ? "rb-stat full" : "rb-stat"}>
                <span>{pos}</span><b>{count(squadPlayers, pos)}/{RULES.squad[pos]}</b>
              </div>
            ))}
            <div className={starters.length === 11 ? "rb-stat full" : "rb-stat"}><span>Starting</span><b>{starters.length}/11</b></div>
          </div>
        </div>
        {(overClubs.length > 0 || message) && (
          <div className="warnings" role="status">
            {overClubs.length > 0 && <p>Too many from {overClubs.map(([c, n]) => `${c} (${n})`).join(", ")}. The limit is {RULES.maxPerClub} per club.</p>}
            {message && <p>{message}</p>}
          </div>
        )}

        <div className="builder">
          <EditablePitch starters={starters} bench={bench} captain={team.captain} actions={actions} dragPos={active?.from === "pool" ? dragged?.pos : null} />

          <Zone id="pool" className="market panel" label="Player market: drop a squad player here to remove them">
            <div className="market-head">
              <h2>Player market</h2>
              <span>Sorted by form</span>
            </div>
            <input className="search" type="search" placeholder="Search players" value={f.q} onChange={(e) => setFilters({ ...f, q: e.target.value })} aria-label="Search players" />
            <div className="filters">
              <div className="pos-chips" role="group" aria-label="Position">
                {["ALL", ...POSITIONS].map((pos) => (
                  <button key={pos} type="button" className={"chip" + (f.pos === pos ? " on" : "")} onClick={() => setFilters({ ...f, pos })}>
                    {pos === "ALL" ? "All" : pos}
                  </button>
                ))}
              </div>
              <select className="club-select" value={f.club} onChange={(e) => setFilters({ ...f, club: e.target.value })} aria-label="Club">
                <option value="ALL">All clubs</option>
                {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="price-filter">
                Up to £{f.maxPrice.toFixed(1)}m
                <input type="range" min="4" max="16" step="0.5" value={f.maxPrice} onChange={(e) => setFilters({ ...f, maxPrice: Number(e.target.value) })} />
              </label>
            </div>
            <ul className="market-grid">
              {visible.map((p) => <MarketCard key={p.id} p={p} inSquad={ids.includes(p.id)} onAdd={(id) => add(id, true)} />)}
              {visible.length === 0 && <li className="empty">No players match. Try a different filter.</li>}
            </ul>
          </Zone>
        </div>

        <div className="action-bar">
          {squad.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => { setTeam(EMPTY); setMessage(null); }}>Clear team</button>}
          <span className="action-note">{problems.length ? problems[0] : "Your team is ready."}</span>
          <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={doReveal}>Reveal points</button>
        </div>
      </section>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          active.from === "pool" ? (
            <div className="drag-card"><PlayerCard name={dragged.short} pos={dragged.pos} club={dragged.club} value={dragged.form ?? "–"} foot={`£${dragged.price.toFixed(1)}m`} tier={tierForPrice(dragged.price)} /></div>
          ) : (
            <div className="drag-token"><Token p={dragged} /></div>
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
