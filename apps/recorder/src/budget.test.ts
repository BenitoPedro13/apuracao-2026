import { expect, test } from 'vitest';
import { backoffMs, Budget } from './budget.js';

const fakeClock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

function drain(b: Budget, clock: ReturnType<typeof fakeClock>, ms: number, outcome = { failed: false }) {
  let n = 0;
  const end = clock.now() + ms;
  while (clock.now() < end) {
    if (b.waitMs() === 0) {
      b.acquire();
      b.release(outcome);
      n++;
    } else clock.advance(1);
  }
  return n;
}

test('token bucket holds the rate: ≤ rate × seconds + burst', () => {
  const clock = fakeClock();
  const b = new Budget({ rateMax: 10, concurrency: 16, now: clock.now });
  const n = drain(b, clock, 10_000);
  expect(n).toBeLessThanOrEqual(10 * 10 + 20);
  expect(n).toBeGreaterThanOrEqual(10 * 10);
});

test('concurrency cap', () => {
  const clock = fakeClock();
  const b = new Budget({ rateMax: 100, concurrency: 2, now: clock.now });
  b.acquire();
  b.acquire();
  expect(b.waitMs()).toBeGreaterThan(0);
  b.release({ failed: false });
  expect(b.waitMs()).toBe(0);
});

test('AIMD: 429 halves the rate (floor 5) and honours Retry-After; +10 per quiet 30 s', () => {
  const clock = fakeClock();
  const b = new Budget({ rateMax: 100, concurrency: 16, now: clock.now });
  b.acquire();
  b.release({ failed: true, pushback: true, retryAfterS: 7 });
  expect(b.rate).toBe(50);
  expect(b.waitMs()).toBe(7_000);
  for (let i = 0; i < 10; i++) {
    b.acquire();
    b.release({ failed: true, pushback: true });
  }
  expect(b.rate).toBe(5);
  clock.advance(30_000);
  b.waitMs();
  expect(b.rate).toBe(15);
  clock.advance(30_000);
  b.waitMs();
  expect(b.rate).toBe(25);
});

test('breaker opens above 20% failures in 30 s and closes after 3 clean 60 s windows', () => {
  const clock = fakeClock();
  const b = new Budget({ rateMax: 100, concurrency: 16, now: clock.now });
  for (let i = 0; i < 8; i++) {
    b.acquire();
    b.release({ failed: false });
  }
  for (let i = 0; i < 3; i++) {
    b.acquire();
    b.release({ failed: true });
  }
  expect(b.breakerOpen).toBe(true); // 3/11 = 27%
  for (let w = 0; w < 3; w++) {
    expect(b.breakerOpen).toBe(true);
    for (let i = 0; i < 4; i++) {
      clock.advance(15_000);
      b.acquire();
      b.release({ failed: false });
    }
  }
  expect(b.breakerOpen).toBe(false);
});

test('breaker stays closed at exactly 20%', () => {
  const clock = fakeClock();
  const b = new Budget({ rateMax: 100, concurrency: 16, now: clock.now });
  for (let i = 0; i < 10; i++) {
    b.acquire();
    b.release({ failed: i < 2 });
  }
  expect(b.breakerOpen).toBe(false);
});

test('backoff: full jitter, base 2 s, cap 60 s', () => {
  expect(backoffMs(1, () => 0.999)).toBeLessThan(2_000);
  expect(backoffMs(3, () => 0.999)).toBeLessThan(8_000);
  expect(backoffMs(20, () => 0.999)).toBeLessThan(60_000);
  expect(backoffMs(20, () => 0)).toBe(0);
});
