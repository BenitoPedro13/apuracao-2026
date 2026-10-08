import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLES_DIR = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
export const sample = (name: string) => readFileSync(`${SAMPLES_DIR}/${name}`);
export const pathOf = (name: string) => name.replace(/_/g, '/');
