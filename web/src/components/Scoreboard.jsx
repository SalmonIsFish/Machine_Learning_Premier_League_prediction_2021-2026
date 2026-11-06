import { useEffect, useState } from "react";

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** A number that rolls up to its value like a scoreboard, when `roll` is on. Otherwise it just shows the value. */
export function Rolling({ value, roll, delay = 0, duration = 900 }) {
  const [shown, setShown] = useState(roll && !reducedMotion() ? 0 : value);
  useEffect(() => {
    if (!roll || reducedMotion()) {
      setShown(value);
      return undefined;
    }
    let tick;
    const steps = 14;
    let i = 0;
    const start = setTimeout(() => {
      tick = setInterval(() => {
        i += 1;
        setShown(i >= steps ? value : Math.floor(Math.random() * (Math.max(value, 3) + 3)));
        if (i >= steps) clearInterval(tick);
      }, duration / steps);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, [value, roll, delay, duration]);
  return <span aria-label={String(value)}>{shown}</span>;
}

/** One LED tile. state: "set" | "final" | "winner" */
export function LedDigit({ value, state = "final", roll, delay }) {
  return <span className={`led led-${state}`}><Rolling value={value} roll={roll} delay={delay} /></span>;
}

/** The huge board at the top of every reveal. */
export function GiantScoreboard({ title, you, machine, roll, tone = "amber", children }) {
  return (
    <div className="giant-wrap">
      <div className={`giant giant-${tone}`} aria-live="polite">
        <p className="giant-title">{title}</p>
        <div className="giant-score">
          <span className="giant-who you">You</span>
          <span className="giant-num you"><Rolling value={you} roll={roll} duration={1300} /></span>
          <span className="giant-colon" aria-hidden="true">:</span>
          <span className="giant-num machine"><Rolling value={machine} roll={roll} duration={1300} /></span>
          <span className="giant-who machine">Machine</span>
        </div>
      </div>
      {children && <p className="giant-verdict">{children}</p>}
    </div>
  );
}

/** ‹ Gameweek 19 › control. */
export function GwStepper({ value, options, onChange, label }) {
  const i = options.indexOf(value);
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(options[i - 1])} disabled={i <= 0} aria-label={`Previous: ${label}`}>‹</button>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {options.map((g) => <option key={g} value={g}>Gameweek {g}</option>)}
      </select>
      <button type="button" onClick={() => onChange(options[i + 1])} disabled={i >= options.length - 1} aria-label={`Next: ${label}`}>›</button>
    </div>
  );
}
