// Derive each municipality's UTC offset for the TSE result feed's `dt/ht`
// (TASK-time-zones.md §2.1, research 03 §2) from the BU files of the 2026 1st round.
// Two independent signals per municipality:
//   S2 opening (the value): polls open at 08:00 Brasília everywhere in Brazil and the urn
//      stamps its local clock (DT_ABERTURA), so the median opening hour gives the shift.
//   S1 receipt (a lower bound): a row can't be stamped before the BUs it totals, so the
//      shift must put ≥ 99% of the municipality's BUs received (DT_BU_RECEBIDO, Brasília
//      time) at or before the row's local `dt/ht` + 15 min. It's only a bound: a row
//      re-stamped later (a re-totalization) also fits smaller shifts (Maceió, Manaus).
// Accepted when S2 respects S1's bound. Any other case is listed and the script exits 1:
// each needs a cited override in scripts/utc-offsets-overrides.json.
// Abroad, urns follow each country's local hours and many cities have DST (Europe's ends on
// 2026-10-25, the 2nd round's day), so the table stores each city's IANA zone
// (scripts/abroad-zones.json, mapped by name) and the BU receipts only check it: the
// zone's offset on that day must be within 30 min of last BU − row.
//
//   node scripts/derive-utc-offsets.ts   # reads .capture/bweb/2026-1t and .capture/ele2026-1t
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = join(import.meta.dirname, '..');
const BWEB = join(ROOT, '.capture/bweb/2026-1t');
const CAPTURE = join(ROOT, '.capture/ele2026-1t');
const OUT = join(ROOT, 'packages/tse/src/data/utc-offsets.json');
const OVERRIDES = join(import.meta.dirname, 'utc-offsets-overrides.json');

interface Section {
  received: number; // ms, Brasília wall time read as if UTC (naive)
  openedMin: number; // local minutes since midnight
}

/** A naive 'YYYY-MM-DD HH:MM:SS' as ms, without any zone. */
const naive = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`);
const naiveTse = (dt: string, ht: string) => {
  const [d, m, y] = dt.split('/');
  return Date.parse(`${y}-${m}-${d}T${ht}Z`);
};

async function readSections(zip: string): Promise<Map<string, Section[]>> {
  const byMu = new Map<string, Section[]>();
  const child = spawn('unzip', ['-p', zip, '*.csv']);
  child.stdout.setEncoding('latin1');
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let ix: Record<string, number> | undefined;
  const seen = new Set<string>();
  for await (const line of rl) {
    const f = line.split(';').map((x) => x.replace(/^"|"$/g, ''));
    if (!ix) {
      ix = Object.fromEntries(f.map((k, i) => [k, i]));
      continue;
    }
    if (!line.includes('"Presidente"') || f[ix['CD_CARGO_PERGUNTA']!] !== '1') continue;
    if (f[ix['DS_TIPO_URNA']!] !== 'Apurada') continue;
    const mu = f[ix['CD_MUNICIPIO']!]!.padStart(5, '0');
    const key = `${mu}|${f[ix['NR_ZONA']!]}|${f[ix['NR_SECAO']!]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const opened = f[ix['DT_ABERTURA']!]!.slice(11, 16);
    const list = byMu.get(mu) ?? [];
    list.push({ received: naive(f[ix['DT_BU_RECEBIDO']!]!), openedMin: Number(opened.slice(0, 2)) * 60 + Number(opened.slice(3)) });
    byMu.set(mu, list);
  }
  await new Promise((r) => child.on('close', r));
  return byMu;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Coverage rows (election 6257) of `area`: municipality → naive local instant. */
function coverageRows(area: string): Map<string, number> {
  const token = readFileSync(join(CAPTURE, `ele2026_6257_dados_${area}_${area}-e006257-ab.jws`), 'utf8');
  const p = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { abr: { tpabr: string; cdabr: string; dt: string; ht: string }[] };
  return new Map(p.abr.filter((r) => r.tpabr === 'mun' && r.dt && r.ht).map((r) => [r.cdabr, naiveTse(r.dt, r.ht)]));
}

/** S1: smallest shift (minutes, local → Brasília) with ≥ 99% of receipts ≤ row + shift + 15 min. */
function receiptShift(sections: Section[], row: number, steps: number[]): number | undefined {
  for (const shift of steps) {
    const limit = row + (shift + 15) * 60_000;
    if (sections.filter((s) => s.received <= limit).length >= 0.99 * sections.length) return shift;
  }
  return undefined;
}

type Entry = { uf: string; utcOffsetMinutes?: number; ianaZone?: string; source: string };
const ABROAD = (JSON.parse(readFileSync(join(import.meta.dirname, 'abroad-zones.json'), 'utf8')) as { zones: Record<string, string> }).zones;

/** UTC offset (minutes) of `zone` at UTC instant `ms` (Intl's tz data). */
function zoneOffsetAt(zone: string, ms: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')!.value;
  const m = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name)!;
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
const overrides = existsSync(OVERRIDES)
  ? (JSON.parse(readFileSync(OVERRIDES, 'utf8')) as Record<string, { utcOffsetMinutes?: number; ianaZone?: string; source: string }>)
  : {};
const table: Record<string, Entry> = {};
const disagreements: string[] = [];
const stats: Record<string, { municipalities: number; medianLagMin: number }> = {};
const zips = readdirSync(BWEB).filter((f) => f.endsWith('.zip')).sort();

for (const zip of zips) {
  const uf = /_([A-Z]{2})_/.exec(zip)![1]!.toLowerCase();
  const t0 = Date.now();
  const sections = await readSections(join(BWEB, zip));
  const rows = coverageRows(uf);
  const lags: number[] = [];
  for (const [mu, row] of rows) {
    const secs = sections.get(mu);
    if (!secs?.length) {
      disagreements.push(`${uf}/${mu}: no BU`);
      continue;
    }
    let shift: number | undefined;
    let source: string;
    const override = overrides[mu];
    if (override?.ianaZone) {
      table[mu] = { uf, ianaZone: override.ianaZone, source: override.source };
      continue;
    }
    if (override?.utcOffsetMinutes !== undefined) {
      shift = -180 - override.utcOffsetMinutes;
      source = override.source;
    } else if (uf === 'zz') {
      const zone = ABROAD[mu];
      if (!zone) {
        disagreements.push(`zz/${mu}: no IANA zone mapped`);
        continue;
      }
      const offset = zoneOffsetAt(zone, row); // `row` is the local wall time; a few hours' error can't cross a DST change here
      const fromReceipts = (Math.max(...secs.map((x) => x.received)) - row) / 60_000;
      if (Math.abs(-180 - offset - fromReceipts) > 30) {
        disagreements.push(`zz/${mu}: ${zone} is UTC${offset / 60} that day, BU receipts say UTC${((-180 - fromReceipts) / 60).toFixed(2)}`);
        continue;
      }
      table[mu] = { uf, ianaZone: zone, source: 'IANA zone by city name, within 30 min of the BU receipts' };
      lags.push(-180 - offset - fromReceipts);
      continue;
    } else {
      const s1 = receiptShift(secs, row, [-60, 0, 60, 120]);
      const s2 = 8 * 60 - Math.round(median(secs.map((s) => s.openedMin)) / 60) * 60;
      if (s1 === undefined || s2 < s1) {
        disagreements.push(`${uf}/${mu}: opening says ${s2} min, receipts need ≥ ${s1} min (${secs.length} sections)`);
        continue;
      }
      shift = s2;
      source = 'urn-opening, within the BU-receipt bound';
    }
    if (shift === undefined) {
      disagreements.push(`${uf}/${mu}: no shift fits the receipts`);
      continue;
    }
    table[mu] = { uf, utcOffsetMinutes: -180 - shift, source };
    // Verification §5 item 2: last BU → row instant, both in Brasília time.
    lags.push((row + shift * 60_000 - Math.max(...secs.map((s) => s.received))) / 60_000);
  }
  stats[uf] = { municipalities: lags.length, medianLagMin: lags.length ? +median(lags).toFixed(1) : NaN };
  console.log(`${uf}: ${sections.size} municipalities with BUs, ${lags.length} resolved, median lag ${stats[uf].medianLagMin} min (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const byOffset: Record<string, number> = {};
for (const e of Object.values(table)) {
  const k = e.ianaZone ? 'abroad (IANA zone)' : String(e.utcOffsetMinutes);
  byOffset[k] = (byOffset[k] ?? 0) + 1;
}
console.log(JSON.stringify({ resolved: Object.keys(table).length, byOffset, disagreements: disagreements.length }, null, 2));
if (disagreements.length) {
  console.log(disagreements.join('\n'));
  process.exit(1);
}
// Abroad cities with no counted section (no row instant to check) still get their zone.
for (const [mu, zone] of Object.entries(ABROAD)) table[mu] ??= { uf: 'zz', ianaZone: zone, source: 'IANA zone by city name; no counted section to check it against' };

// Compact: codes grouped by fixed offset (Brazil) or zone (abroad); a source only where it
// isn't the default.
const DEFAULT_SOURCES = new Set(['urn-opening, within the BU-receipt bound', 'IANA zone by city name, within 30 min of the BU receipts']);
const byFixedOffset: Record<string, string[]> = {};
const abroad: Record<string, string> = {};
const notes: Record<string, string> = {};
for (const [mu, e] of Object.entries(table).sort(([a], [b]) => a.localeCompare(b))) {
  if (e.ianaZone) abroad[mu] = e.ianaZone;
  else (byFixedOffset[String(e.utcOffsetMinutes)] ??= []).push(mu);
  if (!DEFAULT_SOURCES.has(e.source)) notes[mu] = e.source;
}
// A UF-level stamp copies the wall clock of the UF's latest-stamped municipality
// (TASK-time-zones.md §2.1 item 2): the UF's zone, taken from its capital (AM spans two
// zones; Manaus is the majority's).
const indexToken = readFileSync(join(CAPTURE, 'ele2026_6257_config_mun-e006257-cm.jws'), 'utf8');
const index = JSON.parse(Buffer.from(indexToken.split('.')[1]!, 'base64url').toString('utf8')) as { abr: { cd: string; mu: { cd: string; c: string }[] }[] };
const byUf: Record<string, number> = {};
for (const a of index.abr) {
  const capital = a.mu.find((m) => m.c === 's');
  if (a.cd !== 'zz' && capital && table[capital.cd]?.utcOffsetMinutes !== undefined) byUf[a.cd] = table[capital.cd]!.utcOffsetMinutes!;
}
mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      note:
        'Time zone of the TSE result feed dt/ht per municipality (TSE code), generated by scripts/derive-utc-offsets.ts from the 2026 1st-round BU files (TASK-time-zones.md). Brazil: fixed UTC offsets in minutes, from the urns\' opening time within the BU-receipt bound; abroad: IANA zones by city name, checked against BU receipts. `notes` cites every other source.',
      sources: zips,
      stats,
      byFixedOffset,
      byUf,
      abroad,
      notes,
    },
    null,
    1,
  ) + '\n',
);
console.log(`wrote ${OUT}: ${Object.keys(table).length} municipalities`);
