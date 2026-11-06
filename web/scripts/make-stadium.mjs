// Draws the floodlit stadium behind every page and saves it as public/stadium.svg.
// Run once with: node scripts/make-stadium.mjs  (only needed if you change the artwork)
import { writeFileSync } from "node:fs";

const W = 1440;
const H = 520;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);

// the crowd: rows of small dots, with a few bright colours
const quiet = ["#2A3A63", "#35466F", "#46587F", "#6B7BA0", "#1F2C4F"];
const bright = ["#C9D3E6", "#FFB81C", "#E5343E", "#27E0FF", "#FFFFFF"];
let crowd = "";
for (let row = 0; row < 26; row++) {
  const y = 138 + row * 12.5;
  const gap = 6.4 + row * 0.42;
  const r = (1.3 + row * 0.07).toFixed(1);
  for (let x = -8; x < W + 8; x += gap) {
    const hot = rnd() < 0.15;
    const fill = hot ? bright[Math.floor(rnd() * 5)] : quiet[Math.floor(rnd() * 5)];
    crowd += `<circle cx="${Math.round(x + rnd() * 2.6)}" cy="${Math.round(y + rnd() * 4)}" r="${r}" fill="${fill}" opacity="${((hot ? 0.62 : 0.5) + row * 0.012).toFixed(2)}"/>`;
  }
}

const tiers = [216, 322].map((y) => `<rect y="${y}" width="${W}" height="9" fill="#0A1224"/><rect y="${y}" width="${W}" height="1.5" fill="#3A4C78" opacity=".8"/>`).join("");
const roofPosts = Array.from({ length: 37 }, (_, i) => `<rect x="${i * 40}" y="98" width="3" height="36" fill="#16244A"/>`).join("");
const roof = `<rect y="98" width="${W}" height="36" fill="#0A1224"/>${roofPosts}<rect y="133" width="${W}" height="2" fill="#46587F"/>`;

const beam = (x, dir) => `<path d="M${x - 60} 80L${x + 60} 80L${x + dir * 560 + 300} ${H}L${x + dir * 560 - 300} ${H}Z" fill="url(#beam)" filter="url(#soft)"/>`;
const lamps = (x) => {
  let dots = "";
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) dots += `<circle cx="${x - 50 + i * 20}" cy="${34 + j * 15}" r="6" fill="#F7FBFF"/>`;
  return `<rect x="${x - 4}" y="84" width="8" height="58" fill="#1B2C52"/><rect x="${x - 64}" y="22" width="128" height="62" rx="4" fill="#1B2C52"/>${dots}<circle cx="${x}" cy="54" r="120" fill="url(#halo)"/>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040815"/><stop offset=".6" stop-color="#0D1A38"/><stop offset="1" stop-color="#060B16"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDEBFF" stop-opacity=".4"/><stop offset="1" stop-color="#DDEBFF" stop-opacity="0"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060B16" stop-opacity="0"/><stop offset="1" stop-color="#060B16"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#EAF3FF" stop-opacity=".8"/><stop offset="1" stop-color="#EAF3FF" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${crowd}${tiers}${roof}${beam(190, 1)}${beam(W - 190, -1)}${lamps(190)}${lamps(W - 190)}
<rect y="${H - 190}" width="${W}" height="190" fill="url(#fade)"/>
</svg>
`;

writeFileSync(new URL("../public/stadium.svg", import.meta.url), svg);
console.log(`wrote public/stadium.svg (${(svg.length / 1024).toFixed(0)} KB)`);
