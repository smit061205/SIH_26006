/**
 * Marine paint, as on working bulk carriers: dark topsides above red
 * antifouling (the split is at the summer load line, so a ship in ballast
 * shows its red bottom), a green deck, oxide-red hatch covers, a white
 * superstructure and yellow cargo gear. Real colours rather than theme
 * tokens: the ships should look like ships in both themes; the lighting
 * changes instead (day or dusk).
 */
export const PAINT = {
  topsides: "#1e2833",
  bottom: "#74251f",
  deck: "#4e6452",
  hatch: "#8b3b2e",
  superstructure: "#e8eae5",
  crane: "#d9a42b",
  funnel: "#1e2833",
  funnelBand: "#e8eae5",
  funnelStripe: "#2f6fd6",
  lifeboat: "#ef6a1a",
  rail: "#e2e5df",
  steel: "#6b7178",
  darkSteel: "#2c3136",
  glass: "#15222b",
  anchor: "#23272b",
  rust: "#6e3b24",
  quay: "#8d8a83",
  fender: "#1b1b1b",
} as const;
