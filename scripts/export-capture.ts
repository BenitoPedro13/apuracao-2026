// Export the 1st round from the raw log to disk, for fake-tse (TASK-fake-tse.md §2.1).
// Read-only on the bucket. For every 1st-round path, the version the projector would accept
// (valid signature and schema, highest idg, then earliest fetchedAt, then sha256: the fold's
// order, packages/views/src/fold.ts) is written byte for byte as
// .capture/ele2026-1t/<path with / → _>. Idempotent: an existing identical file is kept.
//
//   aws login && node scripts/export-capture.ts [--bucket apuracao26-raw-860897618882] [--out .capture/ele2026-1t]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { Observation } from '@apuracao/contracts';
import { blobKey, mapLimit, SegmentSource } from '@apuracao/projector';
import { importKeys, parsePath, parseTseFile, verifyJws, type TseJwk } from '@apuracao/tse';

const ROOT = join(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    bucket: { type: 'string', default: 'apuracao26-raw-860897618882' },
    region: { type: 'string', default: 'sa-east-1' },
    out: { type: 'string', default: join(ROOT, '.capture/ele2026-1t') },
  },
});
const s3 = new S3Client({ region: values.region });
const bucket = values.bucket;
const FIRST_ROUND = new Set(['6257', '6259']);
/** research 02 §9. */
const EXPECTED_TOTAL = 11_443;

async function getBytes(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body!.transformToByteArray();
}

// Keys: the pinned TSE key plus any rotation the recorder accepted.
const jwks: TseJwk[] = [JSON.parse(readFileSync(join(ROOT, 'packages/tse/keys/prod.jwk.json'), 'utf8')) as TseJwk];
for (const o of (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'meta/keys/' }))).Contents ?? []) {
  jwks.push(JSON.parse(Buffer.from(await getBytes(o.Key!)).toString('utf8')) as TseJwk);
}
const keys = await importKeys(jwks);

// Every version observation of a 1st-round path.
const source = new SegmentSource(s3, bucket, 600_000);
const refs = await source.poll();
console.log(`${refs.length} segments`);
const candidates = new Map<string, Map<string, Observation>>(); // path → sha → earliest observation
let read = 0;
await mapLimit(refs, 32, async (ref) => {
  const { observations } = await source.read(ref);
  for (const o of observations) {
    if (o.kind !== 'version' || !o.sha256) continue;
    if (!(o.fileType === 'c' || (o.election && FIRST_ROUND.has(o.election)))) continue;
    const bySha = candidates.get(o.path) ?? new Map<string, Observation>();
    candidates.set(o.path, bySha);
    const prev = bySha.get(o.sha256);
    if (!prev || o.fetchedAt < prev.fetchedAt) bySha.set(o.sha256, o);
  }
  if (++read % 500 === 0) console.log(`  read ${read}/${refs.length}`);
});

// The fold's order. An observation's idg is a hint for ordering; the blob is re-verified.
const order = (a: Observation, b: Observation) =>
  Number(b.idg ?? -1) - Number(a.idg ?? -1) || a.fetchedAt.localeCompare(b.fetchedAt) || a.sha256!.localeCompare(b.sha256!);

mkdirSync(values.out, { recursive: true });
const groups = new Map<string, number>();
const problems: string[] = [];
let written = 0;
await mapLimit([...candidates.entries()], 32, async ([path, bySha]) => {
  for (const o of [...bySha.values()].sort(order)) {
    const bytes = await getBytes(blobKey(o.sha256!));
    const sig = await verifyJws(Buffer.from(bytes).toString('utf8'), keys);
    if (sig.status !== 'valid' || !parseTseFile(path, sig.payload).ok) continue;
    const file = join(values.out, path.replace(/\//g, '_'));
    if (!existsSync(file) || createHash('sha256').update(readFileSync(file)).digest('hex') !== o.sha256) {
      writeFileSync(file, bytes);
      written++;
    }
    const info = parsePath(path);
    const group = info.fileType === 'c' || info.fileType === 'cm' ? 'config' : `${info.election} ${info.fileType}${info.scope?.level === 'mu' ? ' municipal' : ''}`;
    groups.set(group, (groups.get(group) ?? 0) + 1);
    return;
  }
  problems.push(`${path}: no valid version among ${bySha.size}`);
});

// fake-tse serves the TSE's key at its real path.
writeFileSync(join(values.out, 'app_assets_assinatura-jws_prod.jwk.json'), readFileSync(join(ROOT, 'packages/tse/keys/prod.jwk.json')));

const total = [...groups.values()].reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ out: values.out, total, written, groups: Object.fromEntries([...groups].sort()), problems }, null, 2));
if (total !== EXPECTED_TOTAL || problems.length) {
  console.error(`expected ${EXPECTED_TOTAL} files with a valid version (research 02 §9), got ${total}`);
  process.exit(1);
}
