import { expect, test } from 'vitest';
import { hasUtcOffset, localOffsetMinutes, totalizationInstant } from './timezone.js';
import { readSample } from './samples.test-helper.js';

// Stamps below are copied from real captured TSE files (`.capture/ele2026-1t`, research 03).

test('every municipality of the president index has a time zone (5,571 + 186 abroad)', () => {
  const token = readSample('ele2026_6257_config_mun-e006257-cm.jws').toString('utf8');
  const index = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { abr: { mu: { cd: string }[] }[] };
  const codes = index.abr.flatMap((a) => a.mu.map((m) => m.cd));
  expect(codes).toHaveLength(5_757);
  expect(codes.filter((mu) => !hasUtcOffset(mu))).toEqual([]);
});

test('an Acre row is local time: 16:17:01 in ac01040 is 18:17:01 in Brasília', () => {
  // ac-e006257-ab row 01040 (dt/ht 04/10/2026 16:17:01); file generated 05/10 12:51:40.
  const at = totalizationInstant('04/10/2026', '16:17:01', '05/10/2026', '12:51:40', { mu: '01040' });
  expect(at).toBe('2026-10-04T16:17:01-05:00');
  expect(Date.parse(at)).toBe(Date.parse('2026-10-04T18:17:01-03:00'));
});

test('a central re-stamp is Brasília time: mt90700 dt 05/10 12:51:05, generated 12:52:18', () => {
  // As local time (UTC−4) it would be 13:51:05 Brasília, after the file's own generation.
  expect(localOffsetMinutes({ mu: '90700' }, '05/10/2026', '12:51:05')).toBe(-240);
  expect(totalizationInstant('05/10/2026', '12:51:05', '05/10/2026', '12:52:18', { mu: '90700' })).toBe('2026-10-05T12:51:05-03:00');
});

test('a governor file in eastern Amazonas stays local: am98450 dt 04:59:33, generated 06:08:33', () => {
  expect(totalizationInstant('05/10/2026', '04:59:33', '05/10/2026', '06:08:33', { mu: '98450' })).toBe('2026-10-05T04:59:33-04:00');
});

test('Fernando de Noronha (pe30015) is UTC−2; aggregates and Brasília municipalities are UTC−3', () => {
  // pe-e006259-ab (hg 06/10 16:59:20 Brasília) stamps pe30015's row 17:57:45: Noronha time,
  // i.e. 16:57:45 Brasília, before the file's generation (research 03 §2).
  expect(localOffsetMinutes({ mu: '30015' }, '06/10/2026', '17:57:45')).toBe(-120);
  expect(Date.parse(totalizationInstant('06/10/2026', '17:57:45', '06/10/2026', '16:59:20', { mu: '30015' }))).toBe(Date.parse('2026-10-06T16:57:45-03:00'));
  expect(localOffsetMinutes({}, '04/10/2026', '18:00:00')).toBe(-180);
  expect(totalizationInstant('05/10/2026', '12:51:05', '05/10/2026', '12:52:35', { mu: '71072' })).toBe('2026-10-05T12:51:05-03:00');
});

test('abroad uses the zone on that date: Paris is UTC+2 on 10-04 and UTC+1 on 10-25 (DST ends)', () => {
  expect(localOffsetMinutes({ mu: '30287' }, '04/10/2026', '23:00:00')).toBe(120);
  expect(localOffsetMinutes({ mu: '30287' }, '25/10/2026', '23:00:00')).toBe(60);
  expect(localOffsetMinutes({ mu: '30228' }, '25/10/2026', '23:00:00')).toBe(-240); // New York: DST until 11-01
});

test('a UF stamp is in the zone of the UF capital: br-ab says ac 18:54:23 = Rio Branco local = 20:54:23 Brasília', () => {
  // br-e006257-ab row "ac" (hg 05/10 12:51:41) equals ac01457's row wall clock.
  expect(Date.parse(totalizationInstant('04/10/2026', '18:54:23', '05/10/2026', '12:51:41', { uf: 'ac' }))).toBe(Date.parse('2026-10-04T20:54:23-03:00'));
  expect(localOffsetMinutes({ uf: 'am' }, '05/10/2026', '00:58:39')).toBe(-240);
  expect(localOffsetMinutes({ uf: 'sp' }, '05/10/2026', '00:58:39')).toBe(-180);
  // The central re-stamp on the UF's own row stays Brasília (12:51:05, generated 12:51:40).
  expect(totalizationInstant('05/10/2026', '12:51:05', '05/10/2026', '12:51:40', { uf: 'ac' })).toBe('2026-10-05T12:51:05-03:00');
});
