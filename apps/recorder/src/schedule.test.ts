import { expect, test } from 'vitest';
import { nextDueFromHeaders, Schedule } from './schedule.js';

test('pops in due order, coalescing a path to its earliest due time', () => {
  const s = new Schedule();
  s.add('b', 200);
  s.add('a', 100);
  s.add('c', 300);
  s.add('c', 50); // earlier: moves up
  s.add('a', 500); // later: ignored
  expect(s.size).toBe(3);
  expect([s.popDue(1000), s.popDue(1000), s.popDue(1000), s.popDue(1000)]).toEqual(['c', 'a', 'b', undefined]);
});

test('nothing pops before it is due; equal due times keep insertion order', () => {
  const s = new Schedule();
  for (const p of ['m1', 'm2', 'm3']) s.add(p, 10);
  expect(s.popDue(9)).toBeUndefined();
  expect([s.popDue(10), s.popDue(10), s.popDue(10)]).toEqual(['m1', 'm2', 'm3']);
});

test('popDueWhere skips items the filter rejects (breaker open)', () => {
  const s = new Schedule();
  s.add('mun', 1);
  s.add('br', 2);
  expect(s.popDueWhere(10, (p) => p === 'br')).toBe('br');
  expect(s.has('mun')).toBe(true);
});

test('next poll is never before Expires (invariant 4)', () => {
  const now = Date.UTC(2026, 9, 25, 20, 0, 0);
  const expires = new Date(now + 37_000).toUTCString();
  expect(nextDueFromHeaders({ expires }, now, () => 1_500, 60)).toBe(now + 37_000 + 1_500);
  // Already expired: poll now (+ jitter), never in the past.
  expect(nextDueFromHeaders({ expires: new Date(now - 5_000).toUTCString() }, now, () => 1_000, 60)).toBe(now + 1_000);
  // No Expires: Date + max-age.
  expect(nextDueFromHeaders({ date: new Date(now).toUTCString(), cacheControl: 'max-age=53' }, now, () => 0, 60)).toBe(now + 53_000);
  // Nothing: the fallback.
  expect(nextDueFromHeaders({}, now, () => 0, 60)).toBe(now + 60_000);
});
