import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LatestPointer, Manifest } from "@apuracao/contracts";

// Real published files: the live bucket's 1st-round final (epoch 1t-final, seq 11468), each
// object checked against its hash when copied (TASK-visual-pass-2.md §4). Never hand-built.

export const REAL_DIR = join(import.meta.dirname, "real");
export const readReal = (key: string) => readFileSync(join(REAL_DIR, key));
export const realJson = (key: string): unknown => JSON.parse(readReal(key).toString("utf8"));

export const pointer = LatestPointer.parse(realJson("data/v1/latest.json"));
export const manifest = Manifest.parse(realJson(`data/v1/${pointer.epoch}/m/${String(pointer.seq).padStart(12, "0")}.json`));
export const viewSha = (name: string) => {
  const sha = manifest.views[name];
  if (!sha) throw new Error(`no view ${name} in the real manifest`);
  return sha;
};
export const realView = (name: string) => realJson(`data/v1/o/${viewSha(name)}.json`);
