import { describe, expect, it } from 'vitest';
import { CountTimeline } from './timeline.js';

const timeline = {
  v: 1,
  kind: 'count-timeline',
  office: 'president',
  year: 2022,
  round: 2,
  source: { kind: 'totalization-history', url: 'https://cdn.tse.jus.br/x.zip', sha256: 'a'.repeat(64), rows: 2 },
  sectionsTotal: 472075,
  candidates: [
    { n: 13, name: 'LULA', party: 'PT' },
    { n: 22, name: 'JAIR BOLSONARO', party: 'PL' },
  ],
  at: ['2022-10-30T17:00:51-03:00', '2022-10-30T17:00:52-03:00'],
  sections: [55, 85],
  valid: [20341, 26550],
  votes: [
    [10291, 13568],
    [10050, 12982],
  ],
  gaps: [],
};

describe('CountTimeline', () => {
  it('accepts aligned, ordered points', () => {
    expect(CountTimeline.parse(timeline).at).toHaveLength(2);
  });

  it('rejects misaligned columns, time going back and sections decreasing', () => {
    expect(CountTimeline.safeParse({ ...timeline, valid: [1] }).success).toBe(false);
    expect(CountTimeline.safeParse({ ...timeline, votes: [[1, 2]] }).success).toBe(false);
    expect(CountTimeline.safeParse({ ...timeline, at: [...timeline.at].reverse() }).success).toBe(false);
    expect(CountTimeline.safeParse({ ...timeline, sections: [85, 55] }).success).toBe(false);
    expect(CountTimeline.safeParse({ ...timeline, sectionsTotal: 60 }).success).toBe(false);
  });
});
