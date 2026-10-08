import type { TsePct } from "@apuracao/contracts";

// pt-BR formatting. The TSE's percentages are shown as published, never recomputed
// (architecture.md §7.1); only numbers we compute go through `formatBp`.

const TZ = "America/Sao_Paulo";
const intFmt = new Intl.NumberFormat("pt-BR");
const bpFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatInt = (n: number) => intFmt.format(n);

/** The TSE's own string, e.g. "45,16" → "45,16%". */
export const formatTsePct = (pct: TsePct) => `${pct.raw}%`;

/** Our own figure in basis points, e.g. 187 → "1,87". */
export const formatBp = (bp: number) => bpFmt.format(bp / 100);

/** Brasília time, "17:14". */
export const formatTime = (t: string | number) => timeFmt.format(new Date(t));
/** "05/10, 12:51" in Brasília time. */
export const formatDateTime = (t: string | number) => dateTimeFmt.format(new Date(t));

const CONNECTORS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

/** "FLAVIO BOLSONARO" → "FB": the candidate's mark until photos are cleared (§2.6). */
export function initials(name: string): string {
  const words = name.toUpperCase().split(/\s+/).filter((w) => w && !CONNECTORS.has(w));
  const picked = words.length >= 2 ? [words[0]!, words[words.length - 1]!] : words;
  return picked.map((w) => w[0]).join("");
}

/** "ESCRITOR AUGUSTO CURY" → "Escritor Augusto Cury": the TSE's spelling, title-cased. */
export function displayName(name: string): string {
  return name
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((w, i) => (i > 0 && CONNECTORS.has(w.toUpperCase()) ? w : w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1)))
    .join(" ");
}

/** The TSE's percentage string as a number, for bar widths and colour only (never shown). */
export const pctNumber = (pct: TsePct) => Number(pct.raw.replace(",", "."));
