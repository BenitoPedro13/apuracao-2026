// Upload the web app's static export to the public bucket (TASK-web-shell-and-data-hooks.md
// §2.5). Hashed `_next/static/**` and `geo/*.topo.json` first (immutable), then everything else (HTML and the RSC
// payloads, max-age=60), so no page ever references an asset that isn't there yet. Text is
// stored gzipped with Content-Encoding (S3 doesn't compress; browsers decode).
//
// Never touches `data/` (the projector's), and never deletes: a `sync --delete` at the
// bucket root would remove the published data. Old hashed assets stay; they're tiny and a
// page cached for 60 s may still ask for them. Checks the pointer's ETag before and after.
//
//   pnpm --filter @apuracao/web build && aws login && node scripts/deploy-web.ts [--dry-run]
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { POINTER_KEY } from '@apuracao/contracts';

const ROOT = join(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    bucket: { type: 'string', default: 'apuracao26-pub-860897618882' },
    region: { type: 'string', default: 'sa-east-1' },
    dir: { type: 'string', default: join(ROOT, 'apps/web/out') },
    'dry-run': { type: 'boolean', default: false },
  },
});
const s3 = new S3Client({ region: values.region });
const bucket = values.bucket;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=60';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

const files = walk(values.dir).map((path) => ({ path, key: relative(values.dir, path).split(sep).join('/') }));
if (!files.some((f) => f.key === 'index.html')) throw new Error(`${values.dir} has no index.html: run the web build first`);
const forbidden = files.filter((f) => f.key === 'data' || f.key.startsWith('data/'));
if (forbidden.length) throw new Error(`refusing to upload under data/: ${forbidden.map((f) => f.key).join(', ')}`);
const unknown = files.filter((f) => !TYPES[extname(f.key)]);
if (unknown.length) throw new Error(`no content type for: ${unknown.map((f) => f.key).join(', ')}`);

// Content-hashed names never change content: Next's assets and the map geometry
// (geo/br-mun-2025.{sha8}.topo.json, TASK-map.md §2.1).
const isHashed = (key: string) => key.startsWith('_next/static/') || /^geo\/[\w-]+\.[0-9a-f]{8}\.topo\.json$/.test(key);
const hashed = files.filter((f) => isHashed(f.key));
const rest = files.filter((f) => !isHashed(f.key));

async function pointerEtag(): Promise<string | undefined> {
  try {
    return (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: POINTER_KEY }))).ETag;
  } catch {
    return undefined;
  }
}

async function put(f: { path: string; key: string }, cacheControl: string) {
  const type = TYPES[extname(f.key)]!;
  const text = /text|javascript|json|svg/.test(type);
  const raw = readFileSync(f.path);
  const body = text ? gzipSync(raw, { level: 9 }) : raw;
  if (values['dry-run']) return console.log(`would put ${f.key} (${type}, ${cacheControl}${text ? ', gzip' : ''}, ${body.length} B)`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: f.key,
      Body: body,
      ContentType: type,
      CacheControl: cacheControl,
      ...(text ? { ContentEncoding: 'gzip' } : {}),
    }),
  );
}

async function putAll(list: typeof files, cacheControl: string) {
  for (let i = 0; i < list.length; i += 16) await Promise.all(list.slice(i, i + 16).map((f) => put(f, cacheControl)));
}

const before = await pointerEtag();
await putAll(hashed, IMMUTABLE);
await putAll(rest, SHORT);
const after = await pointerEtag();
console.log(`${values['dry-run'] ? 'dry run: ' : ''}${hashed.length} immutable + ${rest.length} short-lived objects to s3://${bucket}`);
// The projector rewrites the pointer every 60 s when it runs, so a change can be its, not ours;
// this script never writes under data/ (checked above).
console.log(`pointer ETag before ${before ?? '(none)'}, after ${after ?? '(none)'}${before === after ? ': unchanged' : ' (changed: the projector is running?)'}`);
console.log(`entry: https://${bucket}.s3.${values.region}.amazonaws.com/index.html`);
