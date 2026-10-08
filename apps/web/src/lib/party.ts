// Party colours for the two runoff parties; everyone else is neutral. Colour is never the
// only cue (invariant 7): every coloured mark sits next to the name, party and number.
// The CSS variables are defined per theme in globals.css with AA contrast as text.

const PARTY_VAR: Record<string, string> = {
  PT: "var(--party-pt)",
  PL: "var(--party-pl)",
};

export const partyColor = (party: string) => PARTY_VAR[party] ?? "var(--party-other)";
