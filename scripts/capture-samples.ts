// One-off: capture the .jws sibling of every saved .json sample that lacks one
// (docs/tasks/TASK-contracts-and-tse-parsing.md §2.1). Sequential, 1 s apart, no query
// string, never overwrites an existing file. Run with: node scripts/capture-samples.ts
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'https://resultados.tse.jus.br/oficial/';
const SAMPLES = join(import.meta.dirname, '../docs/research/samples');
const USER_AGENT = 'apuracao-2026 research capture (one-off, 7 requests)';

// Sample names are the URL path with '/' replaced by '_'. Directory segments never contain
// '_', so the mapping is unambiguous.
const toPath = (name: string) => name.replace(/_/g, '/');

const targets = readdirSync(SAMPLES)
  .filter((f) => /^(ele2026|comum)_.*\.json$/.test(f))
  .filter((f) => !existsSync(join(SAMPLES, f.replace(/\.json$/, '.jws'))));

let requests = 0;
for (const [i, jsonName] of targets.entries()) {
  if (i > 0) await sleep(1000);
  const jwsName = jsonName.replace(/\.json$/, '.jws');
  const url = BASE + toPath(jwsName);
  requests++;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) {
    console.log(`${res.status} ${url}`);
    continue;
  }
  const text = await res.text();
  writeFileSync(join(SAMPLES, jwsName), text, { flag: 'wx' });

  const payload = Buffer.from(text.trim().split('.')[1] ?? '', 'base64url');
  const saved = readFileSync(join(SAMPLES, jsonName));
  if (payload.equals(saved)) {
    console.log(`200 ${jwsName}: payload == saved .json`);
  } else {
    const idg = (JSON.parse(payload.toString('utf8')) as { idg?: string }).idg ?? 'unknown';
    const variant = jsonName.replace(/\.json$/, `.${idg}.json`);
    writeFileSync(join(SAMPLES, variant), payload, { flag: 'wx' });
    console.log(`200 ${jwsName}: payload DIFFERS from saved .json; saved as ${variant}`);
  }
}
console.log(`requests made: ${requests}`);
