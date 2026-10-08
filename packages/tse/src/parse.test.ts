import { expect, test } from 'vitest';
import { parseTseFile } from './parse.js';
import { readSample, sampleNames, samplePath } from './samples.test-helper.js';

test.each(sampleNames('json'))('%s parses with the schema its path selects', (name) => {
  const r = parseTseFile(samplePath(name), readSample(name));
  expect(r.ok ? [] : r.issues).toEqual([]);
});

test('a bad integer is reported with its field, never thrown', () => {
  const name = 'ele2026_6257_dados_br_br-c0001-e006257-u.json';
  const json = JSON.parse(readSample(name).toString('utf8')) as { s: { st: string } };
  json.s.st = '499.248';
  const r = parseTseFile(samplePath(name), new TextEncoder().encode(JSON.stringify(json)));
  expect(r.ok).toBe(false);
  expect(r.ok ? [] : r.issues[0]).toMatch(/^s\.st: /);
});

test('non-JSON bytes and unknown paths are failures, not exceptions', () => {
  expect(parseTseFile('comum/config/ele-c.json', new Uint8Array([0xff, 0xfe])).ok).toBe(false);
  expect(parseTseFile('nope.json', new Uint8Array()).ok).toBe(false);
});
