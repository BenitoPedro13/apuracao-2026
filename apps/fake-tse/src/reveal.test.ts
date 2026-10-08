import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importKeys, parseTseFile, verifyJws, type TseJwk } from '@apuracao/tse';
import { expect, test } from 'vitest';
import { jwsPayload, createTestSigner, corruptSignature } from './sign.js';
import { IDG_OFFSET, loadCapture, planReveal, REPLAY_START_1T, stepAt, Timeline, tseDateTime, versionAt, type PlanEntry } from './reveal.js';

// Real captured files only (docs/research/samples/).
const samplesDir = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const capture = loadCapture(samplesDir);
const plan = planReveal(capture, REPLAY_START_1T);
const signer = createTestSigner();
const prodJwk = JSON.parse(readFileSync(`${samplesDir}/app_assets_assinatura-jws_prod.jwk.json`, 'utf8')) as TseJwk;

const SP_AB = 'ele2026/6257/dados/sp/sp-e006257-ab.jws';
const SP_MU = 'ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws';
const BR_U = 'ele2026/6257/dados/br/br-c0001-e006257-u.jws';
const BR_AB = 'ele2026/6257/dados/br/br-e006257-ab.jws';
const at = (iso: string) => Date.parse(iso);
const payload = (b: Buffer) => JSON.parse(jwsPayload(b).toString('utf8')) as { idg: string; dg: string; hg: string; abr: Record<string, unknown>[] };
const coverage = (path: string) => plan.entries.get(path) as Extract<PlanEntry, { kind: 'coverage' }>;
const final = (path: string) => JSON.parse(readFileSync(`${samplesDir}/${path.replace(/\//g, '_').replace(/\.jws$/, '.json')}`, 'utf8')) as {
  idg: string;
  abr: Record<string, unknown>[];
};

test('a municipal -u is absent before its coverage row instant, byte-identical after', () => {
  // sp71072's row in sp-ab says 04/10 21:50:33; the file itself says 05/10 12:51:05.
  const row = at('2026-10-04T21:50:33-03:00');
  expect(versionAt(plan, SP_MU, row - 1, signer)).toBeUndefined();
  const v = versionAt(plan, SP_MU, row, signer)!;
  expect(v.build().equals(capture.get(SP_MU)!)).toBe(true);
});

test('aggregate -u files appear at their own final dt/ht: not before', () => {
  expect(versionAt(plan, BR_U, at('2026-10-05T12:51:04-03:00'), signer)).toBeUndefined();
  expect(versionAt(plan, BR_U, at('2026-10-05T12:51:05-03:00'), signer)!.build().equals(capture.get(BR_U)!)).toBe(true);
});

test('a rebuilt -ab has exactly the rows with ht ≤ tReal, verbatim, in the file order', () => {
  const tReal = at('2026-10-04T19:00:00-03:00');
  const rebuilt = payload(versionAt(plan, SP_AB, tReal, signer)!.build());
  const expected = final(SP_AB).abr.filter((r) => Date.parse(`${(r['dt'] as string).split('/').reverse().join('-')}T${r['ht'] as string}-03:00`) <= tReal);
  expect(expected.length).toBe(277); // 12 at 17h, 264 at 18h, 1 at exactly 19:00:00 (the sample)
  expect(rebuilt.abr).toEqual(expected);
  // Removed, not zeroed: no row of a municipality not yet totalized.
  expect(rebuilt.abr.some((r) => r['cdabr'] === '71072')).toBe(false);
});

test('rebuilt idg increases per step and stays below the final idg; dg/hg = the latest revealed row', () => {
  const e = coverage(SP_AB);
  const finalIdg = Number(final(SP_AB).idg);
  let prev = -Infinity;
  for (const k of [0, 1, 100, 645]) {
    const t = k === 0 ? REPLAY_START_1T : e.steps[k - 1]!;
    expect(stepAt(e, t)).toBeGreaterThanOrEqual(k);
    const p = payload(versionAt(plan, SP_AB, t, signer)!.build());
    const idg = Number(p.idg);
    expect(idg).toBe(finalIdg - IDG_OFFSET + stepAt(e, t));
    expect(idg).toBeGreaterThan(prev);
    expect(idg).toBeLessThan(finalIdg);
    expect({ d: p.dg, h: p.hg }).toEqual(tseDateTime(k === 0 ? REPLAY_START_1T : e.steps[stepAt(e, t) - 1]!));
    prev = idg;
  }
  expect(payload(versionAt(plan, SP_AB, REPLAY_START_1T, signer)!.build()).abr).toEqual([]);
});

test('from the file’s own hg on, the original -ab is served byte for byte', () => {
  for (const path of [SP_AB, BR_AB]) {
    const e = coverage(path);
    expect(versionAt(plan, path, e.finalAt - 1, signer)!.version).not.toBe('final');
    expect(versionAt(plan, path, e.finalAt, signer)!.build().equals(capture.get(path)!)).toBe(true);
  }
});

test('the br -ab reveals UF rows verbatim at their own ht (no recomputed munf)', () => {
  const p = payload(versionAt(plan, BR_AB, at('2026-10-04T19:00:00-03:00'), signer)!.build());
  expect(p.abr.map((r) => r['cdabr'])).toEqual(['ac']); // AC finished at 18:54:23
  expect(p.abr[0]).toEqual(final(BR_AB).abr[0]);
});

test('a rebuilt file verifies with the test key and parses; it fails with the TSE key', async () => {
  const bytes = versionAt(plan, SP_AB, at('2026-10-04T20:00:00-03:00'), signer)!.build();
  const test = await verifyJws(bytes.toString('utf8'), await importKeys([signer.jwk]));
  expect(test.status).toBe('valid');
  expect(test.status === 'valid' && parseTseFile(SP_AB, test.payload).ok).toBe(true);
  expect((await verifyJws(bytes.toString('utf8'), await importKeys([prodJwk]))).status).toBe('unknown_kid');
  // The same payload under the TSE's kid: the TSE key rejects the signature.
  const [, p, s] = bytes.toString('utf8').split('.');
  const asProd = `${Buffer.from(JSON.stringify({ kid: prodJwk.kid, typ: 'JOSE', alg: 'EdDSA' })).toString('base64url')}.${p}.${s}`;
  expect((await verifyJws(asProd, await importKeys([prodJwk]))).status).toBe('invalid');
});

test('real files keep the TSE signature; a corrupted one is well-formed but invalid', async () => {
  const keys = await importKeys([prodJwk]);
  expect((await verifyJws(capture.get(SP_MU)!.toString('utf8'), keys)).status).toBe('valid');
  expect((await verifyJws(corruptSignature(capture.get(SP_MU)!).toString('utf8'), keys)).status).toBe('invalid');
});

test('bytes are a function of the step only (stable ETag between reveals)', () => {
  const e = coverage(SP_AB);
  const a = versionAt(plan, SP_AB, e.steps[10]!, signer)!;
  const b = versionAt(plan, SP_AB, e.steps[11]! - 1, signer)!;
  if (e.steps[11]! > e.steps[10]!) expect(a.build().equals(b.build())).toBe(true);
});

test('timeline: gaps longer than maxGap are cut, and every event is still reached exactly', () => {
  const tl = new Timeline(REPLAY_START_1T, plan.events, 600_000);
  for (const e of plan.events) expect(tl.toReal(tl.toCompressed(e))).toBe(e);
  // 17:00 → the br files at 12:51 the next day is ~19.9 h real, far less compressed.
  expect(tl.toReal(tl.end)).toBe(plan.events.at(-1));
  expect(tl.end).toBeLessThan(plan.events.at(-1)! - REPLAY_START_1T);
  // Monotone.
  let prev = -Infinity;
  for (let c = 0; c <= tl.end; c += 60_000) {
    expect(tl.toReal(c)).toBeGreaterThanOrEqual(prev);
    prev = tl.toReal(c);
  }
});

// The full 1st-round export (scripts/export-capture.ts, gitignored): runs where it exists.
const CAPTURE = fileURLToPath(new URL('../../../.capture/ele2026-1t', import.meta.url));
test.skipIf(!existsSync(CAPTURE))('a municipal file appears by its own hg even when its row says later (pe30015)', () => {
  const names = ['ele2026_6259_dados_pe_pe-e006259-ab.jws', 'ele2026_6259_dados_pe_pe30015-c0003-e006259-u.jws'];
  const cap = new Map(names.map((n) => [n.replace(/_/g, '/'), readFileSync(`${CAPTURE}/${n}`)] as const));
  const p = planReveal(cap, REPLAY_START_1T);
  const ab = p.entries.get('ele2026/6259/dados/pe/pe-e006259-ab.jws') as Extract<PlanEntry, { kind: 'coverage' }>;
  const mu = p.entries.get('ele2026/6259/dados/pe/pe30015-c0003-e006259-u.jws') as Extract<PlanEntry, { kind: 'file' }>;
  // The -ab (hg 06/10 16:59:20) carries pe30015's row at 17:57:45; the file says hg 16:59:33.
  expect(ab.finalAt).toBe(at('2026-10-06T16:59:20-03:00'));
  expect(ab.rows.find((r) => r.row['cdabr'] === '30015')!.at).toBe(at('2026-10-06T17:57:45-03:00'));
  expect(mu.at).toBe(at('2026-10-06T16:59:33-03:00'));
});
