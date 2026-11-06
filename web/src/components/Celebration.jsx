import { useEffect, useMemo, useState } from "react";

const COLOURS = ["#FFB81C", "#27E0FF", "#FFFFFF", "#FF4D57"];

/** Full-time moment: floodlights flash and confetti falls if you won; the lights dim if you lost. Removes itself. */
export default function Celebration({ result }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), result === "win" ? 4200 : 1800);
    return () => clearTimeout(t);
  }, [result]);
  const bits = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    dur: 2 + Math.random() * 1.6,
    w: 5 + Math.random() * 6,
    h: 9 + Math.random() * 9,
    colour: COLOURS[i % 4],
  })), []);

  let quiet = false;
  try {
    quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    /* keep going */
  }
  if (!on || quiet || result === "draw") return null;
  if (result === "lose") return <div className="lights-dim" aria-hidden="true" />;
  return (
    <div className="celebration" aria-hidden="true">
      <div className="flood-flash" />
      {bits.map((b) => (
        <i key={b.id} style={{ left: `${b.left}%`, width: b.w, height: b.h, background: b.colour, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }} />
      ))}
    </div>
  );
}

export const outcome = (you, machine) => (you > machine ? "win" : you < machine ? "lose" : "draw");
