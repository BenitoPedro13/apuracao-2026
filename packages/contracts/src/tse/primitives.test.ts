import { describe, expect, test } from 'vitest';
import { TseDecimal, TseInt, tseInstant } from './primitives.js';

describe('TseInt', () => {
  test('parses unsigned integer strings', () => {
    expect(TseInt.parse('56104503')).toBe(56104503);
    expect(TseInt.parse('0')).toBe(0);
  });
  test.each(['1.000', '1,0', '', '-1', ' 1', '1 ', '+1', '1e3'])('rejects %j', (s) => {
    expect(TseInt.safeParse(s).success).toBe(false);
  });
  test('rejects values past MAX_SAFE_INTEGER', () => {
    expect(TseInt.safeParse('9007199254740993').success).toBe(false);
  });
});

describe('TseDecimal', () => {
  test('keeps the raw string for display and a number for sorting', () => {
    expect(TseDecimal.parse('47,03')).toEqual({ raw: '47,03', value: 47.03 });
    expect(TseDecimal.parse('100')).toEqual({ raw: '100', value: 100 });
    expect(TseDecimal.parse('47,027772356').value).toBeCloseTo(47.027772356, 9);
  });
  test.each(['47.03', ',5', '5,', '', '1,2,3'])('rejects %j', (s) => {
    expect(TseDecimal.safeParse(s).success).toBe(false);
  });
});

test('tseInstant converts to ISO 8601 in Brasília time', () => {
  expect(tseInstant('05/10/2026', '12:51:05')).toBe('2026-10-05T12:51:05-03:00');
  expect(() => tseInstant('2026-10-05', '12:51:05')).toThrow();
});
