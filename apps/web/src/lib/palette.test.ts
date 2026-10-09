import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE_PARTIES, partyColor, partyKey } from "./party";

// Every party colour is also text: ≥ 4.5:1 on --panel in both themes (TASK-visual-pass-2.md
// §2.1), read from the stylesheet itself.

const css = readFileSync(join(import.meta.dirname, "../app/globals.css"), "utf8");
// The light :root block, then the dark override block that follows it.
const DARK = "@media (prefers-color-scheme: dark) {";
const [light, dark] = [css.slice(css.indexOf(":root {"), css.indexOf(DARK)), css.slice(css.indexOf(DARK))];

const raw = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

/** A property's value in a theme: its own block first, then the light one; var() resolved in the theme. */
function resolve(block: string, name: string, fallback?: string): string {
  const v = raw(block, name) ?? (fallback !== undefined ? raw(fallback, name) : undefined);
  if (!v) throw new Error(`--${name} not found`);
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  return ref ? resolve(block, ref[1]!, fallback) : v;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("party palette", () => {
  for (const [theme, block, fallback] of [
    ["light", light, undefined],
    ["dark", dark, light],
  ] as const) {
    it(`every palette colour is ≥ 4.5:1 on --panel (${theme})`, () => {
      const panel = resolve(block, "panel", fallback);
      for (const key of [...PALETTE_PARTIES.map(partyKey), "other"]) {
        expect(ratio(resolve(block, `party-${key}`, fallback), panel), `${key} ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("names every palette party, and everyone else is neutral", () => {
    expect(new Set(PALETTE_PARTIES.map(partyKey)).size).toBe(8);
    expect(partyColor("PSOL")).toBe("var(--party-other)");
    expect(partyColor("UNIÃO")).toBe("var(--party-uniao)");
  });
});
