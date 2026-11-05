import { useGame } from "../game.jsx";

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#14231b" : "#ffffff";
}

export default function ClubBadge({ club, size = "md" }) {
  const { club: lookup } = useGame();
  const { code, color } = lookup(club);
  return (
    <span className={`badge badge-${size}`} style={{ background: color, color: textOn(color) }} title={club}>
      {code}
    </span>
  );
}
