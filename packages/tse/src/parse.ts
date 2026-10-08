import {
  TseCoverageFile,
  TseElectionCatalog,
  TseMunicipalityIndex,
  TseResultFile,
} from '@apuracao/contracts';
import type { z } from 'zod';
import { parsePath, type PathInfo } from './paths.js';

const SCHEMAS = {
  u: TseResultFile,
  ab: TseCoverageFile,
  cm: TseMunicipalityIndex,
  c: TseElectionCatalog,
} as const;

export type ParsedTseFile =
  | { ok: true; info: PathInfo; data: z.output<(typeof SCHEMAS)[keyof typeof SCHEMAS]> }
  | { ok: false; info?: PathInfo; issues: string[] };

/**
 * Validate a TSE file's JSON bytes (a `.json`, or a verified `.jws` payload) against the
 * schema its path implies. Never throws: a failure is data, and the raw blob is kept
 * regardless (architecture.md §7.1).
 */
export function parseTseFile(path: string, bytes: Uint8Array): ParsedTseFile {
  let info: PathInfo;
  try {
    info = parsePath(path);
  } catch (err) {
    return { ok: false, issues: [(err as Error).message] };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (err) {
    return { ok: false, info, issues: [`not UTF-8 JSON: ${(err as Error).message}`] };
  }
  const result = SCHEMAS[info.fileType].safeParse(json);
  return result.success
    ? { ok: true, info, data: result.data }
    : { ok: false, info, issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
