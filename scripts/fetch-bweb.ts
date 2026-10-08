// Download the TSE's BU files (boletins de urna, one zip per UF and round) for one year and
// round, from the open-data portal's CKAN listing (research 03 §1). Each zip is checked
// against its published .sha512; an existing file with a good hash is kept (idempotent).
// Sequential: the TSE CDN is a public service.
//
//   node scripts/fetch-bweb.ts --year 2026 --round 1   # → .capture/bweb/2026-1t/
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { year: { type: 'string' }, round: { type: 'string' }, only: { type: 'string' } } });
if (!values.year || !values.round) throw new Error('--year and --round are required');
const out = join(ROOT, '.capture/bweb', `${values.year}-${values.round}t`);
mkdirSync(out, { recursive: true });

const pkg = await (await fetch(`https://dadosabertos.tse.jus.br/api/3/action/package_show?id=resultados-${values.year}-boletim-de-urna`)).json() as {
  result: { resources: { url: string }[] };
};
const only = values.only ? new Set(values.only.toUpperCase().split(',')) : undefined;
const urls = pkg.result.resources
  .map((r) => r.url)
  .filter((u) => new RegExp(`/bweb_${values.round}t_[A-Z]{2}_\\d{12}\\.zip$`).test(u))
  .filter((u) => !only || only.has(/_([A-Z]{2})_\d{12}\.zip$/.exec(u)![1]!));
console.log(`${urls.length} files → ${out}`);

const sha512 = async (path: string) => {
  const h = createHash('sha512');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
};

let bytes = 0;
for (const url of urls) {
  const name = url.split('/').pop()!;
  const path = join(out, name);
  const expected = (await (await fetch(`${url}.sha512`)).text()).trim().split(/\s+/)[0]!;
  if (existsSync(path) && (await sha512(path)) === expected) {
    console.log(`  ok (kept) ${name}`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(`${path}.part`));
  const got = await sha512(`${path}.part`);
  if (got !== expected) throw new Error(`${name}: sha512 ${got.slice(0, 16)}… ≠ published ${expected.slice(0, 16)}…`);
  renameSync(`${path}.part`, path);
  bytes += Number(res.headers.get('content-length') ?? 0);
  console.log(`  ok ${name} (${(Number(res.headers.get('content-length') ?? 0) / 1e6).toFixed(1)} MB)`);
}
console.log(`done: ${(bytes / 1e9).toFixed(2)} GB downloaded`);
