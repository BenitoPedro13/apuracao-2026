import { readFileSync, readdirSync } from 'node:fs';

// Real captured TSE files (docs/research/samples/). Sample names are the URL path with
// '/' replaced by '_'.
export const SAMPLES = new URL('../../../docs/research/samples/', import.meta.url);
export const sampleNames = (ext: 'json' | 'jws') =>
  readdirSync(SAMPLES).filter((f) => /^(ele2026|comum)_/.test(f) && f.endsWith(`.${ext}`));
export const readSample = (name: string) => readFileSync(new URL(name, SAMPLES));
export const samplePath = (name: string) => name.replace(/_/g, '/');
