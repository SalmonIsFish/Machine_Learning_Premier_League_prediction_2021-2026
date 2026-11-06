import { play } from "../lib/sound.js";
import { useStored } from "../lib/storage.js";

/** Sound is off until the player turns it on. */
export default function SoundToggle() {
  const [on, setOn] = useStored("sound", false);
  return (
    <button type="button" className={"sound" + (on ? " on" : "")} aria-pressed={on}
      onClick={() => {
        setOn(!on);
        if (!on) setTimeout(() => play("click"), 0);
      }}>
      <span aria-hidden="true">{on ? "🔊" : "🔇"}</span>
      <span className="sound-label">Sound {on ? "on" : "off"}</span>
    </button>
  );
}
