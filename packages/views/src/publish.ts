import { createHash } from 'node:crypto';
import type { Elections, Manifest } from '@apuracao/contracts';
import { canonicalJson } from './canonical.js';

export interface EncodedView {
  name: string;
  sha256: string;
  bytes: Uint8Array;
}

/** Content address of a view: sha256 of its canonical JSON bytes. */
export function encodeView(name: string, json: string): EncodedView {
  const bytes = new TextEncoder().encode(json);
  return { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}

export function buildManifest(o: { epoch: string; seq: number; publishedAt: string; elections: Elections; views: EncodedView[] }): EncodedView {
  const manifest: Manifest = {
    v: 1,
    epoch: o.epoch,
    seq: o.seq,
    publishedAt: o.publishedAt,
    elections: o.elections,
    views: Object.fromEntries(o.views.map((v) => [v.name, v.sha256])),
  };
  return encodeView('manifest', canonicalJson(manifest));
}
