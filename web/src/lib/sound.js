// Match sounds, made in the browser with the Web Audio API (no audio files).
// Sound stays off until the player turns it on; the choice is remembered in storage.js.
import { load } from "./storage.js";

let ctx = null;
const audio = () => {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

function whistle(a) {
  const now = a.currentTime;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.03);
  gain.gain.setValueAtTime(0.12, now + 0.55);
  gain.gain.linearRampToValueAtTime(0, now + 0.75);
  gain.connect(a.destination);
  const tone = a.createOscillator();
  tone.frequency.value = 2250;
  const pea = a.createOscillator(); // the rattle of the pea inside a whistle
  pea.frequency.value = 38;
  const peaDepth = a.createGain();
  peaDepth.gain.value = 170;
  pea.connect(peaDepth).connect(tone.frequency);
  tone.connect(gain);
  tone.start(now);
  pea.start(now);
  tone.stop(now + 0.8);
  pea.stop(now + 0.8);
}

function crowd(a, mood) {
  const now = a.currentTime;
  const length = mood === "roar" ? 2.8 : 1.7;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = a.createBufferSource();
  noise.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.7;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, now);
  if (mood === "roar") {
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.linearRampToValueAtTime(1300, now + 1);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.9);
    gain.gain.linearRampToValueAtTime(0, now + length);
  } else {
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.linearRampToValueAtTime(260, now + length);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.25);
    gain.gain.linearRampToValueAtTime(0, now + length);
  }
  noise.connect(filter).connect(gain).connect(a.destination);
  noise.start(now);
}

function click(a) {
  const now = a.currentTime;
  const osc = a.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain).connect(a.destination);
  osc.start(now);
  osc.stop(now + 0.11);
}

/** Plays a sound if the player has sound on. name: "whistle" | "roar" | "groan" | "click" */
export function play(name) {
  if (!load("sound", false)) return;
  try {
    const a = audio();
    if (!a) return;
    if (name === "whistle") whistle(a);
    else if (name === "click") click(a);
    else crowd(a, name);
  } catch {
    /* sound is optional: never let it break the game */
  }
}

/** Whistle, then the crowd reacts to the result. */
export function playFullTime(result) {
  play("whistle");
  if (result === "draw") return;
  setTimeout(() => play(result === "win" ? "roar" : "groan"), 700);
}
