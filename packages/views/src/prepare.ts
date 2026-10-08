import { createHash } from 'node:crypto';
import type { TseCoverageFile, TseMunicipalityIndex, TseResultFile } from '@apuracao/contracts';
import { parseTseFile, verifyJws, type Keyring } from '@apuracao/tse';
import { extractCoverage, extractIndex, extractResult, type FileData, type PathRole } from './model.js';

/**
 * A stored blob, re-verified and re-parsed with the *current* key ring and contracts
 * (TASK §2.2): the observation's own `sig`/`schema` are not trusted, so files recorded as
 * `schema: failed` before a contract fix project correctly.
 */
export type Prepared = { ok: true; sha256: string; idg: number; data: FileData } | { ok: false; sha256: string; reason: string };

export async function prepare(path: string, role: PathRole, bytes: Uint8Array, keys: Keyring): Promise<Prepared> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sig = await verifyJws(new TextDecoder().decode(bytes), keys);
  if (sig.status !== 'valid') return { ok: false, sha256, reason: `signature ${sig.status}` };
  const parsed = parseTseFile(path, sig.payload);
  if (!parsed.ok) return { ok: false, sha256, reason: `schema: ${parsed.issues.slice(0, 3).join('; ')}` };
  const file = parsed.data as { idg: string };
  try {
    let data: FileData;
    if (role.role === 'result') data = extractResult(parsed.data as TseResultFile, role.office);
    else if (role.role === 'coverage') data = extractCoverage(parsed.data as TseCoverageFile);
    else data = extractIndex(parsed.data as TseMunicipalityIndex);
    return { ok: true, sha256, idg: Number(file.idg), data };
  } catch (err) {
    return { ok: false, sha256, reason: `extract: ${(err as Error).message}` };
  }
}
