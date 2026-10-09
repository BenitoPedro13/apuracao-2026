import { BRASILIA_OFFSET_MINUTES, tseInstant } from '@apuracao/contracts';
import table from './data/utc-offsets.json' with { type: 'json' };

// The time zone of the TSE's stamps (research 03 §2, TASK-time-zones.md):
// - `dg/hg` (generation) are Brasília time;
// - `dt/ht` (totalization) are the municipality's local time, except stamps written by the
//   TSE's central re-totalization, which are Brasília time. A local reading that would put
//   the totalization after the file's own generation is impossible, and identifies those
//   (2026 1st round: exactly the 372 municipal files of UTC−4/−5 UFs stamped 05/10 12:51:05).
// The table (src/data/utc-offsets.json, scripts/derive-utc-offsets.ts) holds fixed offsets
// for Brazil (no DST since 2019) and IANA zones abroad, whose offset depends on the date
// (Europe leaves summer time on 2026-10-25, the 2nd round's day).
// Those come from the runtime's tzdata, so view bytes depend on it (TASK-tzdata-pin.md):
// every place that renders views runs the same Node, and the projector checks it.

/** The tzdata every runtime must carry: Node 24.21.0 (package.json devEngines, CI, images). */
export const TZDATA = '2026c';

/** Throws unless this runtime's tzdata is exactly {@link TZDATA}: same tzdata, same bytes. */
export function assertTzdata(): void {
  const tz = process.versions.tz;
  if (tz !== TZDATA) {
    throw new Error(`tzdata ${tz ?? 'unknown'} in Node ${process.versions.node}, expected ${TZDATA}: run on Node 24.21.0 (TASK-tzdata-pin.md)`);
  }
}

const FIXED = new Map<string, number>();
for (const [offset, codes] of Object.entries(table.byFixedOffset)) for (const mu of codes) FIXED.set(mu, Number(offset));
const ZONES = new Map<string, string>(Object.entries(table.abroad));
const UF_OFFSETS = new Map<string, number>(Object.entries(table.byUf));

/** Where a stamp comes from: a municipality, a UF aggregate, or neither (br, zz: Brasília). */
export interface StampPlace {
  mu?: string;
  uf?: string;
}

/** Whether the table knows `mu` (tests: every municipality must be there). */
export const hasUtcOffset = (mu: string): boolean => FIXED.has(mu) || ZONES.has(mu);

/** One formatter per zone: building an Intl.DateTimeFormat costs far more than using one. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** UTC offset (minutes) of an IANA `zone` at UTC instant `ms`. */
function zoneOffsetAt(zone: string, ms: number): number {
  let fmt = FORMATTERS.get(zone);
  if (!fmt) FORMATTERS.set(zone, (fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })));
  const name = fmt
    .formatToParts(ms)
    .find((p) => p.type === 'timeZoneName')!.value;
  const m = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  return m?.[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * The UTC offset (minutes) of local wall time `dt ht` at `place`: a municipality's zone; a
 * UF aggregate's, from its capital (a UF stamp copies its latest municipality's wall clock;
 * western Amazonas can make that 1 h off); Brasília for br, zz and unknown codes.
 */
export function localOffsetMinutes(place: StampPlace, dt: string, ht: string): number {
  const { mu } = place;
  if (mu === undefined) return (place.uf === undefined ? undefined : UF_OFFSETS.get(place.uf)) ?? BRASILIA_OFFSET_MINUTES;
  const fixed = FIXED.get(mu);
  if (fixed !== undefined) return fixed;
  const zone = ZONES.get(mu);
  if (!zone) return BRASILIA_OFFSET_MINUTES;
  const wall = Date.parse(tseInstant(dt, ht, 0)); // the wall time read as UTC
  return zoneOffsetAt(zone, wall - zoneOffsetAt(zone, wall) * 60_000);
}

/** Slack for a totalization stamped in the same second as the file's generation. */
const SAME_SECOND_MS = 1_000;

/**
 * A TSE totalization `dt/ht` as an ISO instant: in `place`'s local time, unless that falls
 * after the file's generation `dg/hg` (Brasília), in which case it's a central
 * re-totalization stamped in Brasília time.
 */
export function totalizationInstant(dt: string, ht: string, dg: string, hg: string, place: StampPlace = {}): string {
  const offset = localOffsetMinutes(place, dt, ht);
  const local = tseInstant(dt, ht, offset);
  if (offset === BRASILIA_OFFSET_MINUTES) return local;
  return Date.parse(local) <= Date.parse(tseInstant(dg, hg)) + SAME_SECOND_MS ? local : tseInstant(dt, ht);
}
