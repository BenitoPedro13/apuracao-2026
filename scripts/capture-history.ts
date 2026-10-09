// Download the TSE's presidential archive 1994–2022 (research 05 §1): per year, the
// candidate and detail zips from cdn.tse.jus.br/estatistica/sead/odsele/. Sequential and
// conditional (If-None-Match / If-Modified-Since against the last capture): the CDN is a
// public service. Every distinct zip is kept under its sha256 (invariant 2); the TSE
// regenerates some nightly (research 05 §2), so a new hash may carry the same data.
//
//   node scripts/capture-history.ts                         # → .capture/odsele/
//   node scripts/capture-history.ts --bucket apuracao26-raw-860897618882            # dry run
//   node scripts/capture-history.ts --bucket apuracao26-raw-860897618882 --write    # user-run
//
// With --bucket, each zip is also archived write-once to
// hist/odsele/v1/sha256/<aa>/<sha256>.zip (+ .json with the fetch metadata), governance-
// locked for 10 years like raw/ (TASK-recorder.md §6).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { S3Client } from '@aws-sdk/client-s3';
import { putOnce } from '@apuracao/s3kit';
import { odseleUrl, type OdseleType } from '@apuracao/tse';

export const HISTORY_YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022] as const;
export const HISTORY_TYPES: readonly OdseleType[] = ['detalhe_votacao_munzona', 'votacao_candidato_munzona'];
export const CACHE = join(import.meta.dirname, '..', '.capture/odsele');
const USER_AGENT = 'apuracao-2026-history/0.1 (public vote-count dashboard; one download per file)';
const LOCK_YEARS = 10;

/** What we know of the latest capture of one archive file (`<type>_<year>.json`). */
export interface Capture {
  url: string;
  sha256: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
  /** The zip on disk, relative to CACHE. */
  file: string;
}

export const captureMetaPath = (type: OdseleType, year: number) => join(CACHE, `${type}_${year}.json`);
export const readCapture = (type: OdseleType, year: number): Capture | null =>
  existsSync(captureMetaPath(type, year)) ? (JSON.parse(readFileSync(captureMetaPath(type, year), 'utf8')) as Capture) : null;

async function sha256File(path: string) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function capture(type: OdseleType, year: number): Promise<{ c: Capture; fresh: boolean }> {
  const url = odseleUrl(type, year);
  const prev = readCapture(type, year);
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (prev?.etag) headers['if-none-match'] = prev.etag;
  if (prev?.lastModified) headers['if-modified-since'] = prev.lastModified;
  const res = await fetch(url, { headers });
  if (res.status === 304 && prev) return { c: prev, fresh: false };
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  const part = join(CACHE, `${type}_${year}.part`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(part));
  const sha256 = await sha256File(part);
  const file = `${type}_${year}.${sha256.slice(0, 8)}.zip`;
  renameSync(part, join(CACHE, file));
  const c: Capture = {
    url,
    sha256,
    bytes: Number(res.headers.get('content-length') ?? 0),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    fetchedAt: new Date().toISOString(),
    file,
  };
  writeFileSync(captureMetaPath(type, year), JSON.stringify(c, null, 2) + '\n');
  return { c, fresh: prev?.sha256 !== sha256 };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { bucket: { type: 'string' }, write: { type: 'boolean', default: false }, region: { type: 'string', default: 'sa-east-1' } },
  });
  mkdirSync(CACHE, { recursive: true });
  const s3 = values.bucket ? new S3Client({ region: values.region }) : null;
  for (const year of HISTORY_YEARS) {
    for (const type of HISTORY_TYPES) {
      const { c, fresh } = await capture(type, year);
      console.log(`${fresh ? 'new ' : 'same'} ${type}_${year} ${c.sha256.slice(0, 12)} ${(c.bytes / 1e6).toFixed(1)} MB`);
      if (!s3) continue;
      const key = `hist/odsele/v1/sha256/${c.sha256.slice(0, 2)}/${c.sha256}`;
      if (!values.write) {
        console.log(`  would put s3://${values.bucket}/${key}.zip (+ .json)`);
        continue;
      }
      const until = new Date();
      until.setUTCFullYear(until.getUTCFullYear() + LOCK_YEARS);
      const lock = { ObjectLockMode: 'GOVERNANCE' as const, ObjectLockRetainUntilDate: until };
      const zip = await putOnce(s3, { Bucket: values.bucket, Key: `${key}.zip`, Body: readFileSync(join(CACHE, c.file)), ContentType: 'application/zip', ...lock });
      const meta = await putOnce(s3, { Bucket: values.bucket, Key: `${key}.json`, Body: JSON.stringify(c), ContentType: 'application/json', ...lock });
      console.log(`  s3 ${zip} / ${meta}`);
    }
  }
}
