import { z } from 'zod';

// Every TSE number is a string (research 01 §4). These are the only places that turn them
// into numbers (architecture.md §7.1).

/** Unsigned integer string, e.g. "56104503". No separators, signs or spaces. */
export const TseInt = z
  .string()
  .regex(/^\d+$/, 'not a TSE integer')
  .transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));

/**
 * pt-BR decimal string, e.g. "47,03" or "47,027772356". `raw` is what the UI displays
 * (ADR-12: never re-round the TSE's percentages); `value` is for sorting and colour only.
 */
export const TseDecimal = z
  .string()
  .regex(/^\d+(,\d+)?$/, 'not a TSE decimal')
  .transform((raw) => ({ raw, value: Number(raw.replace(',', '.')) }));
export type TseDecimal = z.output<typeof TseDecimal>;

/** `dd/mm/yyyy` */
export const TseDate = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'not a TSE date');
/** `hh:mm:ss`: Brasília time for `dg/hg`, the municipality's local time for most `dt/ht` (research 03 §2) */
export const TseTime = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'not a TSE time');
/** `"s"` (sim) or `"n"` (não) */
export const TseFlag = z.enum(['s', 'n']);
/** Numeric identifier kept as a string (codes, ids). Leading zeros are significant. */
export const TseId = z.string().regex(/^\d+$/, 'not a TSE id');

/** Brasília: UTC−3 (no DST since 2019). */
export const BRASILIA_OFFSET_MINUTES = -180;

/**
 * A TSE date + time as ISO 8601 at `offsetMinutes` from UTC (default Brasília). Generation
 * stamps (`dg/hg`) are Brasília time; totalization stamps (`dt/ht`) are usually the
 * municipality's local time (research 03 §2): see `totalizationInstant` in @apuracao/tse.
 */
export function tseInstant(date: string, time: string, offsetMinutes = BRASILIA_OFFSET_MINUTES): string {
  const [dd, mm, yyyy] = TseDate.parse(date).split('/');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mi = String(abs % 60).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${TseTime.parse(time)}${sign}${hh}:${mi}`;
}

/** Shape helper: the listed keys as TseInt / TseDecimal. */
export const ints = <K extends string>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, TseInt])) as Record<K, typeof TseInt>;
export const decimals = <K extends string>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, TseDecimal])) as Record<K, typeof TseDecimal>;
