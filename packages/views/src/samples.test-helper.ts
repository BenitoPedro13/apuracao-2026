import { readFileSync, readdirSync } from 'node:fs';
import type { Observation } from '@apuracao/contracts';
import { importKeys, type TseJwk } from '@apuracao/tse';
import jwk from '@apuracao/tse/keys/prod.jwk.json' with { type: 'json' };
import type { ViewsConfig } from './model.js';

// Real captured TSE files (docs/research/samples/), named as the URL path with '/' → '_'.
const SAMPLES = new URL('../../../docs/research/samples/', import.meta.url);

export const CFG: ViewsConfig = { elections: { president: '6257', governor: '6259' }, governorUfs: ['rj'] };

export const keyring = () => importKeys([jwk as TseJwk]);

/** Every signed sample: TSE path → bytes. */
export function jwsSamples(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const name of readdirSync(SAMPLES).sort()) {
    if (/^(ele2026|comum)_/.test(name) && name.endsWith('.jws')) out.set(name.replace(/_/g, '/'), readFileSync(new URL(name, SAMPLES)));
  }
  return out;
}

let n = 0;
/** An observation of the kind the recorder writes (our own log format, not TSE data). */
export function obs(path: string, kind: Observation['kind'], fetchedAt: string, extra: Partial<Observation> = {}): Observation {
  return {
    v: 1,
    kind,
    path,
    fileType: 'u',
    fetchedAt,
    recorder: 'rec-test',
    leaseGeneration: 1,
    cycleNo: n++,
    seqInCycle: 0,
    ...extra,
  };
}
