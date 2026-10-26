// "Ao longo da apuração" (TASK-over-the-count.md §2.1): the national president count as
// real points, shipped with the site like the history files. Read-only on the raw bucket.
//
//   pnpm exec node scripts/build-count-timeline.ts                      # 2022 only (downloads its zip once)
//   aws login && pnpm exec node scripts/build-count-timeline.ts --epoch 6258 --days 2026-10-25,2026-10-26
//
// 2022: the TSE's totalization history of the 2nd round (research 03 §4), into
// .capture/hist/. 2026: every version of the national result file our recorder stored
// (obs/ + raw/, invariant 2), re-verified and re-parsed like the projector does (`prepare`);
// the observation segments of `--days` (UTC dates) give the gaps. Deterministic: the same
// inputs give the same bytes. Writes apps/web/public/timeline/count-<year>-<n>t.<sha8>.json
// and apps/web/src/timeline/timeline-files.ts; a series not rebuilt keeps its last file.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { HistoryFile, type CountTimeline, type Observation } from '@apuracao/contracts';
import { blobKey, mapLimit, parseSegmentKey, SegmentSource } from '@apuracao/projector';
import { importKeys, resultPath, totalizationHistoryReader, totalizationHistoryUrl, type TseJwk } from '@apuracao/tse';
import { classify, historyTimeline, observedTimeline, prepare, type ObservedVersion, type ResultData } from '@apuracao/views';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'apps/web/public/timeline');
const TS_OUT = join(ROOT, 'apps/web/src/timeline/timeline-files.ts');
const CACHE = join(ROOT, '.capture/hist');
const USER_AGENT = 'apuracao-2026-history/0.1 (public vote-count dashboard; one download per file)';
const { values } = parseArgs({
  options: {
    epoch: { type: 'string' },
    days: { type: 'string' },
    bucket: { type: 'string', default: 'apuracao26-raw-860897618882' },
    region: { type: 'string', default: 'sa-east-1' },
  },
});

const sha256 = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
type Ref = { path: string; sha256: string };
const files: Record<string, Ref> = existsSync(TS_OUT)
  ? (JSON.parse(/= (\{[\s\S]*\}) as const;/.exec(readFileSync(TS_OUT, 'utf8'))![1]!) as Record<string, Ref>)
  : {};

function write(id: string, t: CountTimeline) {
  const body = JSON.stringify(t);
  const hash = sha256(body);
  const path = `timeline/count-${id}.${hash.slice(0, 8)}.json`;
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.startsWith(`count-${id}.`)) rmSync(join(OUT, f));
  writeFileSync(join(ROOT, 'apps/web/public', path), body);
  files[id] = { path, sha256: hash };
  const last = t.at.length - 1;
  const shares = t.candidates.map((c, i) => `${c.name} ${((t.votes[i]![last]! / t.valid[last]!) * 100).toFixed(2)}%`).join(' × ');
  console.log(`${path}: ${t.at.length} points, ${t.gaps.length} gaps, ${(gzipSync(body).length / 1024).toFixed(0)} KB gzip; last ${t.at[last]} ${t.sections[last]}/${t.sectionsTotal} sections, ${shares}`);
}

// --- 2022, 2nd round: the TSE's totalization history ------------------------------------
{
  const url = totalizationHistoryUrl(2022, 2);
  const zip = join(CACHE, url.split('/').at(-1)!);
  if (!existsSync(zip)) {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(`${zip}.part`));
    renameSync(`${zip}.part`, zip);
  }
  const zipSha = sha256(readFileSync(zip));
  const child = spawn('unzip', ['-p', zip, '*.csv'], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  let reader: ReturnType<typeof totalizationHistoryReader> | null = null;
  const rows = [];
  for await (const raw of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (!raw.trim()) continue;
    if (!reader) reader = totalizationHistoryReader(raw);
    else rows.push(reader.read(raw));
  }
  if (!reader) throw new Error(`${zip}: empty CSV`);
  // Numbers and parties from the archive the history page already checks (build-history --check).
  const history = readdirSync(join(ROOT, 'apps/web/public/history')).find((f) => /^history\.[0-9a-f]{8}\.json$/.test(f));
  if (!history) throw new Error('no history file: run scripts/build-history.ts first');
  const round = HistoryFile.parse(JSON.parse(readFileSync(join(ROOT, 'apps/web/public/history', history), 'utf8'))).rounds.find((r) => r.year === 2022 && r.round === 2)!;
  const candidates = reader.candidates.map((name) => {
    const c = round.candidates.find((x) => x.name === name);
    if (!c) throw new Error(`2022 2T: no candidate named ${name} in ${history}`);
    return c;
  });
  const last = rows.at(-1)!;
  candidates.forEach((c, i) => {
    const want = round.national.votes[round.candidates.indexOf(c)];
    if (last.votes[i] !== want) throw new Error(`2022 2T ${c.name}: history ends on ${last.votes[i]}, the archive says ${want}`);
  });
  if (last.sections !== last.sectionsTotal) throw new Error(`2022 2T: ends on ${last.sections}/${last.sectionsTotal} sections`);
  write('2022-2t', historyTimeline({ year: 2022, round: 2, url, sha256: zipSha, candidates, rows }));
}

// --- 2026: the versions our recorder stored -----------------------------------------------
if (values.epoch) {
  const epoch = values.epoch;
  if (epoch !== '6257' && epoch !== '6258') throw new Error(`--epoch is a president election: 6257 or 6258, got ${epoch}`);
  const days = (values.days ?? '').split(',').filter(Boolean);
  if (!days.length) throw new Error('--days: the UTC dates of the night, e.g. 2026-10-25,2026-10-26');
  const s3 = new S3Client({ region: values.region });
  const bucket = values.bucket;
  const getBytes = async (key: string) => (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body!.transformToByteArray();
  const list = async (prefix: string, delimiter?: string) => {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token }));
      keys.push(...(res.Contents ?? []).map((o) => o.Key!));
      prefixes.push(...(res.CommonPrefixes ?? []).map((p) => p.Prefix!));
      token = res.NextContinuationToken;
    } while (token);
    return { keys, prefixes };
  };

  const jwks: TseJwk[] = [JSON.parse(readFileSync(join(ROOT, 'packages/tse/keys/prod.jwk.json'), 'utf8')) as TseJwk];
  for (const k of (await list('meta/keys/')).keys) jwks.push(JSON.parse(Buffer.from(await getBytes(k)).toString('utf8')) as TseJwk);
  const keys = await importKeys(jwks);

  const recorders = (await list('obs/v1/', '/')).prefixes;
  const refs = (await Promise.all(recorders.flatMap((r) => days.map((d) => list(`${r}${d}/`))))).flatMap((l) => l.keys.map(parseSegmentKey)).filter((r) => r !== undefined);
  console.log(`${refs.length} segments from ${recorders.length} recorders on ${days.join(', ')}`);
  const path = resultPath(epoch, 1, 'br');
  const source = new SegmentSource(s3, bucket, 0);
  const seen = new Map<string, Observation>(); // sha → earliest observation
  await mapLimit(refs, 32, async (ref) => {
    for (const o of (await source.read(ref)).observations) {
      if (o.kind !== 'version' || o.path !== path || !o.sha256) continue;
      const prev = seen.get(o.sha256);
      if (!prev || o.fetchedAt < prev.fetchedAt) seen.set(o.sha256, o);
    }
  });
  const role = classify(path, { elections: { president: epoch, governor: epoch === '6257' ? '6259' : '6260' }, governorUfs: [], legislative: false });
  if (!role) throw new Error(`${path}: not a result path`);
  const versions: ObservedVersion[] = [];
  const rejected: string[] = [];
  await mapLimit([...seen.values()], 16, async (o) => {
    const bytes = await getBytes(blobKey(o.sha256!));
    const p = await prepare(path, role, bytes, keys);
    if (!p.ok) return void rejected.push(`${o.sha256!.slice(0, 12)}: ${p.reason}`);
    if (p.sha256 !== o.sha256) throw new Error(`blob ${o.sha256} hashes to ${p.sha256}`);
    versions.push({ sha256: p.sha256, idg: p.idg, fetchedAt: o.fetchedAt, data: p.data as ResultData });
  });
  console.log(`${path}: ${seen.size} stored versions, ${versions.length} valid${rejected.length ? `, rejected: ${rejected.join('; ')}` : ''}`);
  const t = observedTimeline({ year: 2026, round: epoch === '6258' ? 2 : 1, path, versions, segmentStarts: refs.map((r) => r.cycleStart) });
  for (const [i, v] of t.votes.entries()) {
    for (let k = 1; k < v.length; k++) if (v[k]! < v[k - 1]!) console.warn(`  note: ${t.candidates[i]!.name} goes down at ${t.at[k]} (${v[k - 1]} → ${v[k]})`);
  }
  write(`2026-${epoch === '6258' ? 2 : 1}t`, t);
}

mkdirSync(join(TS_OUT, '..'), { recursive: true });
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(TS_OUT, `// Generated by scripts/build-count-timeline.ts; do not edit.\nexport const COUNT_TIMELINE_FILES = ${JSON.stringify(sorted, null, 2)} as const;\n`);
