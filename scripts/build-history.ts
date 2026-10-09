// Build the presidential archive's two files from the captured zips
// (TASK-historical-presidential.md §2.2). Deterministic: the same zips give the same bytes.
//
//   node scripts/capture-history.ts            # first: the zips, into .capture/odsele/
//   node scripts/build-history.ts [--check]
//
// Writes apps/web/public/history/{history,history-mun}.<sha8>.json and
// apps/web/src/history/history-file.ts. --check fails unless the numbers verified by hand in
// research 05 come out again (a second, independent implementation of the same sums).
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { HistoryFile, HistoryMunicipalities, TseMunicipalityIndex, type HistoryRound } from '@apuracao/contracts';
import { candidateReader, detailReader, presidentCsvName, withoutGeneration, type OdseleType } from '@apuracao/tse';
import { computeInsights, HistoryFold, type Place } from '@apuracao/views';
import { CACHE, HISTORY_TYPES, HISTORY_YEARS, readCapture } from './capture-history.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'apps/web/public/history');
const TS_OUT = join(ROOT, 'apps/web/src/history/history-file.ts');
/** The TSE's own municipality list (research 02 §6): TSE code → IBGE code and accented name. */
const CONFIG = join(ROOT, 'docs/research/samples/ele2026_6257_config_mun-e006257-cm.json');
const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

/** Streams the president CSV of one zip; returns its content identity and generation stamp. */
async function readZip(zip: string, type: OdseleType, onLine: (line: string, header: string) => void) {
  const csv = presidentCsvName(execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n'));
  const child = spawn('unzip', ['-p', zip, csv], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  const content = createHash('sha256');
  let header = '';
  let strip: (l: string) => string = (l) => l;
  let generatedAt = '';
  for await (const raw of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) continue;
    if (!header) {
      header = line;
      strip = withoutGeneration(header);
    } else {
      if (!generatedAt) generatedAt = /^"?([\d/]+)"?;"?([\d:]+)"?/.exec(line)?.slice(1, 3).join(' ') ?? '';
      onLine(line, header);
    }
    content.update(strip(line) + '\n');
  }
  const code = await new Promise<number>((res) => child.on('close', res));
  if (code !== 0) throw new Error(`unzip -p ${zip} ${csv}: exit ${code}`);
  return { csv, contentId: content.digest('hex'), generatedAt, type };
}

const cfg = TseMunicipalityIndex.parse(JSON.parse(readFileSync(CONFIG, 'utf8')));
const places = new Map<string, Place>();
for (const a of cfg.abr) for (const m of a.mu) if (m.cdi) places.set(m.cd, { ibge: m.cdi, name: m.nm });

const fold = new HistoryFold();
const sources: HistoryFile['sources'] = [];
for (const year of HISTORY_YEARS) {
  for (const type of HISTORY_TYPES) {
    const c = readCapture(type, year);
    if (!c) throw new Error(`no capture of ${type}_${year}: run node scripts/capture-history.ts first`);
    let reader: ((l: string) => unknown) | null = null;
    const t0 = Date.now();
    let rows = 0;
    const r = await readZip(join(CACHE, c.file), type, (line, header) => {
      if (!reader) reader = type === 'votacao_candidato_munzona' ? candidateReader(header) : detailReader(header);
      const row = reader(line);
      if (!row) return;
      rows++;
      if (type === 'votacao_candidato_munzona') fold.addCandidate(row as Parameters<HistoryFold['addCandidate']>[0]);
      else fold.addDetail(row as Parameters<HistoryFold['addDetail']>[0]);
    });
    if (rows === 0) throw new Error(`${c.file}: no president rows`);
    sources.push({ url: c.url, sha256: c.sha256, contentId: r.contentId, bytes: c.bytes, generatedAt: r.generatedAt });
    console.log(`${type}_${year}: ${rows} president rows from ${r.csv}, generated ${r.generatedAt} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

const { rounds, municipalities, unjoined } = fold.build(places);
const insights = computeInsights({ rounds, muns: municipalities });
const latest = (i: number) => {
  for (let k = municipalities.rounds.length - 1; k >= 0; k--) {
    const a = municipalities.rounds[k]!.aptos[i];
    if (a !== null && a !== undefined) return a;
  }
  return null;
};
const file = HistoryFile.parse({
  v: 1,
  years: [...HISTORY_YEARS],
  rounds,
  ids: municipalities.ids,
  uf: municipalities.uf,
  name: municipalities.name,
  aptos: municipalities.ids.map((_, i) => latest(i)),
  insights,
  sources,
});
HistoryMunicipalities.parse(municipalities);
console.log(`unjoined: ${JSON.stringify(unjoined)}`);

// --- the research numbers, again --------------------------------------------------------
if (values.check) {
  const fails: string[] = [];
  const eq = (what: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  const near = (what: string, got: number, want: number, tol: number) => {
    if (Math.abs(got - want) > tol) fails.push(`${what}: got ${got}, want ${want} ± ${tol}`);
  };
  const round = (y: number, t: number) => rounds.find((r) => r.year === y && r.round === t)!;
  // research 05 §5: winner, runner-up, registered
  const NATIONAL: [number, number, number, number, number][] = [
    [1994, 1, 34350217, 17112255, 94710636],
    [1998, 1, 35936382, 21475211, 106100575],
    [2002, 2, 52793364, 33370739, 115253816],
    [2006, 2, 58295042, 37543178, 125913235],
    [2010, 2, 55752529, 43711388, 135804433],
    [2014, 2, 54501118, 51041155, 142822046],
    [2018, 2, 57797847, 47040906, 147306294],
    [2022, 2, 60345999, 58206354, 156454011],
  ];
  for (const [y, t, a, b, aptos] of NATIONAL) {
    const r = round(y, t);
    eq(`${y} ${t}T top two`, r.national.votes.slice(0, 2), [a, b]);
    eq(`${y} ${t}T aptos`, r.national.aptos, aptos);
    eq(`${y} ${t}T decisive`, r.decisive, true);
  }
  // research 05 §4: domestic municipalities per year, and the one unjoined code
  const DOMESTIC: Record<number, number> = { 1994: 5019, 1998: 5513, 2002: 5564, 2006: 5565, 2010: 5567, 2014: 5570, 2018: 5570, 2022: 5570 };
  for (const y of HISTORY_YEARS) {
    const k = municipalities.rounds.findIndex((r) => r.year === y && r.round === 1);
    eq(`${y} joined municipalities`, municipalities.rounds[k]!.aptos.filter((a) => a !== null).length, DOMESTIC[y]);
  }
  eq('unjoined', unjoined.map((u) => `${u.year}:${u.tse}`), ['2002:91065']);
  eq('ids', municipalities.ids.length, 5570);
  // research 05 §6
  eq('universe', insights.universe, 5019);
  const hits8 = insights.bellwetherHits.flatMap((h, i) => (h === 8 ? [i] : []));
  eq('bellwethers', hits8.length, 112); // research 05 §6.1 first said 113: it counted a 2002–2022 exact tie as a win
  eq('bellwethers in MG', hits8.filter((i) => municipalities.uf[i] === 'MG').length, 66);
  near('PT r 2002→2006', insights.ptPersistence.find((p) => p.from === 2002)!.r, -0.013, 0.001);
  near('PT r 2018→2022', insights.ptPersistence.find((p) => p.from === 2018)!.r, 0.92, 0.001);
  near('rival r 2014→2018', insights.rivalPersistence.find((p) => p.from === 2014)!.r, 0.874, 0.001);
  const LANDSLIDE: Record<number, number> = { 2006: 0.342, 2010: 0.23, 2014: 0.26, 2018: 0.383, 2022: 0.22 };
  for (const [y, s] of Object.entries(LANDSLIDE)) {
    const l = insights.landslide.find((x) => x.year === Number(y))!;
    near(`landslide ${y}`, l.voters / l.of, s, 0.0005);
  }
  const r22 = round(2022, 2);
  eq('2022 margin', r22.national.votes[0]! - r22.national.votes[1]!, 2139645);
  eq('2022 2T abstentions', r22.national.abstencoes, 32200558);
  const sp = municipalities.ids.indexOf('3550308');
  eq('SP city aptos 2022', municipalities.rounds.find((r) => r.year === 2022 && r.round === 1)!.aptos[sp], 9320706);
  eq('UFs smaller than SP city', Object.values(round(2022, 1).byUf).filter((u) => u.aptos < 9320706).length, 23);
  eq('abroad 1998 / 2022', [round(1998, 1).abroad?.aptos, round(2022, 1).abroad?.aptos], [47469, 695355]);
  eq('no abroad rows in 1994', round(1994, 1).abroad, null);
  eq('2010 transit', round(2010, 1).transit !== null, true);
  if (fails.length) {
    console.error(`check FAILED:\n  ${fails.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check: research 05 reproduced');
}

// --- write, content-addressed -------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^history(-mun-[a-z]{2})?\.[0-9a-f]{8}\.json$/.test(f)) rmSync(join(OUT, f));
const write = (base: string, value: unknown, quiet = false) => {
  const body = JSON.stringify(value);
  const hash = sha256(body);
  const path = `history/${base}.${hash.slice(0, 8)}.json`;
  writeFileSync(join(ROOT, 'apps/web/public', path), body);
  if (!quiet) console.log(`${path}: ${(body.length / 1024).toFixed(0)} KB, ${(gzipSync(body).length / 1024).toFixed(0)} KB gzip`);
  return { path, sha256: hash, gzip: gzipSync(body).length };
};
const { gzip: _, ...main } = write('history', file);
// The municipalities' TSE numbers, one file per UF: a search loads only its UF's.
const byUf: Record<string, { path: string; sha256: string }> = {};
let largest = 0;
for (const uf of [...new Set(municipalities.uf)].sort()) {
  const keep = municipalities.ids.flatMap((_, i) => (municipalities.uf[i] === uf ? [i] : []));
  const pick = <T,>(a: T[]) => keep.map((i) => a[i]!);
  const part = HistoryMunicipalities.parse({
    v: 1,
    ids: pick(municipalities.ids),
    tse: pick(municipalities.tse),
    uf: pick(municipalities.uf),
    name: pick(municipalities.name),
    rounds: municipalities.rounds.map((r) => ({
      ...r,
      aptos: pick(r.aptos),
      comparecimento: pick(r.comparecimento),
      brancos: pick(r.brancos),
      nulos: pick(r.nulos),
      votes: r.votes.map(pick),
    })),
  });
  const { gzip, ...ref } = write(`history-mun-${uf.toLowerCase()}`, part, true);
  largest = Math.max(largest, gzip);
  byUf[uf] = ref;
}
console.log(`history-mun-<uf>: ${Object.keys(byUf).length} files, largest ${(largest / 1024).toFixed(0)} KB gzip`);
mkdirSync(join(TS_OUT, '..'), { recursive: true });
writeFileSync(
  TS_OUT,
  `// Generated by scripts/build-history.ts; do not edit.\nexport const HISTORY_FILES = ${JSON.stringify({ main, municipalities: byUf }, null, 2)} as const;\n`,
);

/** Kept for the summary only: the decisive rounds' top two. */
const summary = (r: HistoryRound) => `${r.year} ${r.round}T ${r.candidates[0]!.name} ${r.national.votes[0]} × ${r.candidates[1]!.name} ${r.national.votes[1]}`;
for (const r of rounds) if (r.decisive) console.log(summary(r));
