// Party colours (TASK-visual-pass-2.md §2.1): eight parties by national weight in the 1st
// round, everyone else neutral. Colour is never the only cue (invariant 7): every coloured
// mark sits next to the sigla. The CSS variables are defined per theme in globals.css with
// AA contrast as text (palette.test.ts).

export const PALETTE_PARTIES = ["PL", "PT", "UNIÃO", "PSD", "PP", "REPUBLICANOS", "MDB", "PODE"] as const;

const KEY: Record<string, string> = {
  PL: "pl",
  PT: "pt",
  "UNIÃO": "uniao",
  PSD: "psd",
  PP: "pp",
  REPUBLICANOS: "republicanos",
  MDB: "mdb",
  PODE: "pode",
};

/** The palette key of a party (`--party-<key>`), "other" outside the palette. */
export const partyKey = (party: string) => KEY[party] ?? "other";

export const hasOwnColour = (party: string) => party in KEY;

// Written out in full: the CSS build keeps only the custom properties the sources name, so
// a name assembled at runtime ("--party-" + key) would be dropped from the stylesheet.
const COLOUR: Record<string, string> = {
  pl: "var(--party-pl)",
  pt: "var(--party-pt)",
  uniao: "var(--party-uniao)",
  psd: "var(--party-psd)",
  pp: "var(--party-pp)",
  republicanos: "var(--party-republicanos)",
  mdb: "var(--party-mdb)",
  pode: "var(--party-pode)",
  other: "var(--party-other)",
};

export const keyColor = (key: string) => COLOUR[key] ?? COLOUR.other!;
export const partyColor = (party: string) => keyColor(partyKey(party));


/** Where space is short (map labels, tiles): siglas over 7 letters, cut with a dot. */
export const shortParty = (party: string) => (party.length > 7 ? `${party.slice(0, 5)}.` : party);
