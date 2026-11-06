import { useGame } from "../game.jsx";
import Jersey from "./Jersey.jsx";

/** Card tier from a player's price: gold £8.0m and up, silver £6.0m to £7.5m, bronze below that. */
export const tierForPrice = (price) => (price >= 8 ? "gold" : price >= 6 ? "silver" : "bronze");

/** The collectible player card. `value` is the big number; `foot` is the small text at bottom right. */
export default function PlayerCard({ name, pos, club, value, foot, tier = "silver", faded, small, children }) {
  const { club: lookup } = useGame();
  return (
    <div className={`pcard pcard-${tier}` + (faded ? " faded" : "") + (small ? " small" : "")}>
      <span className="pcard-foil" aria-hidden="true" />
      <div className="pcard-top">
        <span className="pcard-value">{value}</span>
        <span className="pcard-pos">{pos}</span>
      </div>
      <Jersey club={club} size={small ? 58 : 78} />
      <span className="pcard-name" title={name}>{name}</span>
      <div className="pcard-foot">
        <span title={club}>{lookup(club).code}</span>
        <span>{foot}</span>
      </div>
      {children}
    </div>
  );
}
