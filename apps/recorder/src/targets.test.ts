import { expect, test } from 'vitest';
import { loadConfig } from './config.js';
import { configFiles, probePaths, tier1Files } from './targets.js';

const targets = loadConfig({ RAW_BUCKET: 'bucket' }).RECORDER_TARGETS;
const target = (office: number) => targets.find((t) => t.election === '6259' && t.office === office)!;

test('senate and deputies: UF result files only, 27/27/26/1 (TASK-legislative-archive.md §2.1)', () => {
  const counts = [5, 6, 7, 8].map((office) => tier1Files(target(office)).length);
  expect(counts).toEqual([27, 27, 26, 1]);
  for (const office of [5, 6, 7, 8]) {
    const files = tier1Files(target(office));
    expect(files.every((f) => f.kind === 'aggregate' && /\/[a-z]{2}-c000\d-e006259-u\.jws$/.test(f.path))).toBe(true);
    expect(configFiles(target(office))).toEqual([]);
  }
  expect(tier1Files(target(7)).some((f) => f.path.includes('/df/'))).toBe(false);
  expect(tier1Files(target(8)).map((f) => f.path)).toEqual(['ele2026/6259/dados/df/df-c0008-e006259-u.jws']);
  expect(probePaths(target(6))).toEqual(['ele2026/6259/dados/sp/sp-c0006-e006259-u.jws']);
  expect(probePaths(target(8))).toEqual(['ele2026/6259/dados/df/df-c0008-e006259-u.jws']);
});

test('the governor target still tracks coverage and the municipality index', () => {
  const files = tier1Files(target(3));
  expect(files.filter((f) => f.kind === 'coverage')).toHaveLength(27);
  expect(configFiles(target(3))).toHaveLength(1);
});
