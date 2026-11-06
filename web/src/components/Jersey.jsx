import { kitFor } from "../lib/kits.js";

const BODY = "M20 6L12 9L2 20L10 28L15 23V58H49V23L54 28L62 20L52 9L44 6C41 11 23 11 20 6Z";

/** A drawn shirt in the club's colours. */
export default function Jersey({ club, size = 64 }) {
  const [main, second, pattern] = kitFor(club);
  return (
    <svg className="jersey" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${club} shirt`}>
      <path d={BODY} fill={main} />
      {pattern === "stripes" && [19, 27, 35, 43].map((x) => <rect key={x} x={x} y="13" width="4" height="45" fill={second} />)}
      {pattern === "halves" && <path d="M32 9.8C37 9.8 42 8.5 44 6L52 9L62 20L54 28L49 23V58H32Z" fill={second} />}
      {pattern === "sash" && <path d="M15 44L49 14V27L15 57Z" fill={second} />}
      {pattern === "sleeves" ? (
        <>
          <path d="M15 8L12 9L2 20L10 28L15 23Z" fill={second} />
          <path d="M49 8L52 9L62 20L54 28L49 23Z" fill={second} />
        </>
      ) : (
        <>
          <path d="M2 20L10 28L12.5 25.5L4.5 17.5Z" fill={second} />
          <path d="M62 20L54 28L51.5 25.5L59.5 17.5Z" fill={second} />
        </>
      )}
      <path d="M20 6C23 11 41 11 44 6L41 5C38 8 26 8 23 5Z" fill={second} />
      <path d={BODY} fill="none" stroke="#060B16" strokeOpacity=".55" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
