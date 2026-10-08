import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { LatestPointer, Manifest, manifestKey, POINTER_KEY, ResultView, viewKey } from "@apuracao/contracts";
import { DATA_BASE_URL } from "../src/data/config";

export const DATA = DATA_BASE_URL;
export const REPO = resolve(import.meta.dirname, "../../..");

export async function liveJson(key: string): Promise<unknown> {
  const res = await fetch(`${DATA}/${key}`);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  return res.json();
}

export async function liveManifest() {
  const pointer = LatestPointer.parse(await liveJson(POINTER_KEY));
  const manifest = Manifest.parse(await liveJson(manifestKey(pointer.epoch, pointer.seq)));
  return { pointer, manifest };
}

export async function liveResult(manifest: Manifest, name: string) {
  return ResultView.parse(await liveJson(viewKey(manifest.views[name]!)));
}

/**
 * Serves the data the page reads from a local published directory (a real replay), with
 * the pointer rewritten as `pointer(p)` returns it. Only the pointer changes; every view
 * and manifest is the real file, so its hash still verifies.
 */
export async function routeDataFrom(page: Page, pubDir: string, pointer: (p: LatestPointer) => LatestPointer) {
  await page.route(`${DATA}/**`, async (route) => {
    const key = new URL(route.request().url()).pathname.replace(/^\/+/, "");
    if (key === POINTER_KEY) {
      const p = LatestPointer.parse(JSON.parse(readFileSync(join(pubDir, POINTER_KEY), "utf8")));
      return route.fulfill({ json: pointer(p), headers: { "access-control-allow-origin": "*" } });
    }
    try {
      return route.fulfill({ body: readFileSync(join(pubDir, key)), contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
    } catch {
      return route.fulfill({ status: 403, headers: { "access-control-allow-origin": "*" } });
    }
  });
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
