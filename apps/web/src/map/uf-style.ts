import { type LegislativeUfView, type MunicipalityView, type ResultStatus } from "@apuracao/contracts";
import { senateElected, shareStep, type UfBench } from "@/data/chambers";
import { outcomeLabel, type GovernorRace } from "@/data/governors";
import { displayName, formatBp, formatInt, formatTsePct } from "@/lib/format";
import { partyKey, shortParty } from "@/lib/party";
import { areaName } from "@/lib/places";
import type { Geometry } from "./geometry";
import { leaderOfVotes } from "./margin";
import { marginStep, parsePartyToken, partyToken, type FillToken, type MapStyle } from "./style";

// The per-UF maps (TASK-visual-pass-2.md §2.2–2.4): one cell per UF says how it's filled
// and labelled; `styleCells` turns cells into the renderer's buckets. Pure, tested on the
// real views.

export interface UfCell {
  uf: string;
  token: FillToken;
  /** A second colour over the lower-right half (two senators, a two-way tie). */
  split?: FillToken;
  /** The label's second line on the map, e.g. "PSD 63,96%". Empty: sigla only. */
  label: string;
  /** The party whose colour marks the label's chip. */
  party: string | null;
  /** The hover card's lines. */
  lines: string[];
}

export interface LegendItem {
  token: FillToken;
  split?: FillToken;
  label: string;
}

export interface MunicipalCard {
  name: string;
  token: FillToken;
  lines: string[];
}

/** Municipalities of one UF drawn on their own (the governor's selected state). */
export interface Overlay {
  uf: string;
  tokenOf: Map<number, FillToken>;
  describe(i: number): MunicipalCard | null;
}

export function styleCells(geo: Geometry, cells: Readonly<Record<string, UfCell>>, overlay: Overlay | null = null): MapStyle {
  const tokenOf: FillToken[] = new Array(geo.count);
  for (let i = 0; i < geo.count; i++) {
    const uf = geo.ufs[i]!;
    const own = overlay?.uf === uf ? overlay.tokenOf.get(i) : undefined;
    // With one state drawn by municipality, the others step back to their lightest shade.
    tokenOf[i] = own ?? (overlay ? faded(cells[uf]?.token) : cells[uf]?.token) ?? "waiting";
  }
  const buckets = new Map<FillToken, number[]>();
  tokenOf.forEach((t, i) => {
    const b = buckets.get(t);
    if (b) b.push(i);
    else buckets.set(t, [i]);
  });
  const splits = Object.values(cells)
    .filter((c) => c.split && c.uf !== overlay?.uf)
    .map((c) => ({ uf: c.uf, token: overlay ? faded(c.split)! : c.split! }));
  return { buckets, failed: [], tokenOf, splits };
}

const faded = (token: FillToken | undefined): FillToken | undefined => {
  const p = token && parsePartyToken(token);
  return p ? partyToken(p.key, 1) : token;
};
const missing = (status: ResultStatus | undefined): FillToken => (status === "no_sections" ? "empty" : "waiting");
const strong = (party: string) => partyToken(partyKey(party), 4);
const person = (c: { name: string; party: string }) => `${displayName(c.name)} (${c.party})`;

// --- Governor ----------------------------------------------------------------------------

export function governorCell(r: GovernorRace, runoff: boolean): UfCell {
  const base = { uf: r.uf, party: null, label: "" };
  if (r.outcome === "sem-disputa") return { ...base, token: "none", lines: [outcomeLabel(r.outcome, runoff)] };
  if (!r.first) return { ...base, token: missing(r.status), lines: [outcomeLabel(r.outcome, runoff)] };
  const lines = [`${person(r.first)}: ${formatTsePct(r.first.pct)}`];
  if (r.second) lines.push(`${person(r.second)}: ${formatTsePct(r.second.pct)}`);
  lines.push(outcomeLabel(r.outcome, runoff));
  return {
    ...base,
    token: partyToken(partyKey(r.first.party), r.outcome === "eleito" ? 4 : 2),
    label: `${shortParty(r.first.party)} ${formatTsePct(r.first.pct)}`,
    party: r.first.party,
    lines,
  };
}

/** The selected UF's municipalities: leader's colour, 4 margin steps, exact ties hatched. */
export function municipalOverlay(geo: Geometry, view: MunicipalityView): Overlay {
  const byCdi = new Map<string, number>();
  geo.ids.forEach((cdi, i) => byCdi.set(cdi, i));
  const tokenOf = new Map<number, FillToken>();
  const rowOf = new Map<number, MunicipalityView["rows"][number]>();
  for (const row of view.rows) {
    const i = row.cdi ? byCdi.get(row.cdi) : undefined;
    if (i === undefined) continue;
    rowOf.set(i, row);
    const l = row.votes && row.validWithSubJudice ? leaderOfVotes(row.votes, row.validWithSubJudice) : null;
    tokenOf.set(
      i,
      l && l.leader >= 0
        ? partyToken(partyKey(view.candidates[l.leader]!.party), marginStep(l.marginBp))
        : l && l.marginBp === 0
          ? "tie"
          : missing(row.status),
    );
  }
  return {
    uf: view.area,
    tokenOf,
    describe(i) {
      const row = rowOf.get(i);
      if (!row) return null;
      const token = tokenOf.get(i) ?? "waiting";
      const l = row.votes && row.validWithSubJudice ? leaderOfVotes(row.votes, row.validWithSubJudice) : null;
      const lines: string[] = [];
      if (l && l.leader >= 0) {
        const c = view.candidates[l.leader]!;
        const pct = row.pct?.[l.leader];
        lines.push(`${person(c)} lidera${pct ? ` com ${formatTsePct(pct)}` : ""}`);
        lines.push(`Vantagem de ${formatBp(l.marginBp)} pontos (calculada)`);
      } else if (l && l.marginBp === 0) lines.push("Empate exato entre os dois mais votados");
      else lines.push(row.status === "no_sections" ? "Nenhuma seção apurada" : "Aguardando dados do TSE");
      if (row.sections) lines.push(`${formatTsePct(row.sections.countedPct)} das seções apuradas`);
      return { name: row.name, token, lines };
    },
  };
}

// --- Senate ------------------------------------------------------------------------------

export function senateCell(uf: string, v: LegislativeUfView | undefined): UfCell {
  const base = { uf, party: null, label: "" };
  if (!v || v.seats === null) return { ...base, token: missing(v?.status), lines: ["Aguardando dados do TSE"] };
  const elected = senateElected(v);
  const [a, b] = elected;
  if (!a) return { ...base, token: missing(v.status), lines: ["Nenhum eleito no arquivo do TSE"] };
  const same = !b || b.party === a.party;
  return {
    ...base,
    token: strong(a.party),
    split: same ? undefined : strong(b.party),
    label: same ? `${shortParty(a.party)}${b ? " ×2" : ""}` : `${shortParty(a.party)} · ${shortParty(b.party)}`,
    party: a.party,
    lines: elected.map((c) => `${person(c)}: ${formatInt(c.votes)} votos`),
  };
}

// --- Câmara and Assembleias ---------------------------------------------------------------

export type ChamberMode = "bancada" | "partido";

export function benchCell(b: UfBench): UfCell {
  const base = { uf: b.uf, party: null, label: "" };
  if (b.seats === null) return { ...base, token: "waiting", lines: ["Aguardando dados do TSE"] };
  const of = `de ${b.seats} vagas`;
  const top = b.parties.slice(0, 3).map((p) => `${p.party} ${p.seats}`).join(", ");
  const lines = [`${top}${b.parties.length > 3 ? ", …" : ""} (${of})`];
  const [first, second] = b.largest;
  if (!first) return { ...base, token: "empty", lines: ["Nenhum eleito no arquivo do TSE"] };
  const seats = b.parties[0]!.seats;
  if (b.largest.length === 1) return { ...base, token: strong(first), label: `${shortParty(first)} ${seats}/${b.seats}`, party: first, lines };
  if (b.largest.length === 2) {
    return { ...base, token: strong(first), split: strong(second!), label: `${shortParty(first)} · ${shortParty(second!)} ${seats}`, party: first, lines: [`Empate: ${first} e ${second}, ${seats} cada`, ...lines] };
  }
  return { ...base, token: "tie", label: `${b.largest.length} com ${seats}`, lines: [`Empate entre ${b.largest.join(", ")}: ${seats} cada`, ...lines] };
}

export function partyShareCell(b: UfBench, party: string): UfCell {
  const base = { uf: b.uf, party, label: "" };
  if (b.seats === null) return { ...base, token: "waiting", party: null, lines: ["Aguardando dados do TSE"] };
  const seats = b.parties.find((p) => p.party === party)?.seats ?? 0;
  const step = shareStep(seats, b.seats);
  return {
    ...base,
    token: step === 0 ? "empty" : partyToken(partyKey(party), step),
    label: `${seats}/${b.seats}`,
    lines: [seats === 0 ? `${party}: nenhum eleito de ${b.seats} vagas` : `${party}: ${seats} de ${b.seats} vagas`],
  };
}

export const SHARE_LEGEND = ["menos de 10% das vagas", "10–25%", "25–40%", "40% ou mais"] as const;

/** For the canvas's accessible name. */
export function ufListSummary(title: string, cells: readonly UfCell[]): string {
  const parts = cells.filter((c) => c.label).map((c) => `${areaName(c.uf)} ${c.label}`);
  return `${title}: ${parts.join("; ")}.`;
}
