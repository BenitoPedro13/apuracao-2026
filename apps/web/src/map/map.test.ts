import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LegislativeBrView, LegislativeUfView, MapIndexView, MapView, MunicipalityView, RESULT_STATUS_CODE } from "@apuracao/contracts";
import { senateElected, ufBenches } from "@/data/chambers";
import { realView } from "../../test/real";
import { GEO_FILE } from "./geo-file";
import { decodeGeometry, GeoFile, WIDTH } from "./geometry";
import { countedStep, leaderCounts, marginStep, mixHex, styleFrame, tieCount } from "./style";
import { benchCell, municipalOverlay, senateCell, styleCells } from "./uf-style";

// On the committed geometry and the real published 1st-round frame (never hand-built).

const bytes = readFileSync(join(import.meta.dirname, "../../public", GEO_FILE.path));
const file = GeoFile.parse(JSON.parse(bytes.toString("utf8")));
const geo = decodeGeometry(file);
const frame = MapView.parse(realView("map/president"));
const index = MapIndexView.parse(realView("map-index/president"));

describe("geometry", () => {
  it("is the committed file the generated module names", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(GEO_FILE.sha256);
    expect(file.apuracao.index).toBe(GEO_FILE.index);
  });

  it("has the 5,571 municipalities in the published index's order", () => {
    expect(geo.count).toBe(5571);
    expect(geo.ids).toEqual(index.cdi);
    expect(geo.ufs).toEqual(index.uf);
    expect(geo.index).toBe(frame.index);
    expect(createHash("sha256").update(geo.ids.join("\n")).digest("hex")).toBe(frame.index);
  });

  it("decodes every municipality into non-empty rings inside the map box", () => {
    for (let i = 0; i < geo.count; i++) {
      expect(geo.rings[i]!.length).toBeGreaterThan(0);
      const [x0, y0, x1, y1] = geo.bbox.subarray(i * 4, i * 4 + 4);
      expect(x0).toBeGreaterThanOrEqual(-0.01);
      expect(x1).toBeLessThanOrEqual(WIDTH + 0.01);
      expect(y0).toBeGreaterThanOrEqual(-0.01);
      expect(y1).toBeLessThanOrEqual(geo.height + 0.01);
    }
    // Measured 0.940 (Fernando de Noronha widens the box eastward); a projection or clip
    // change would move it.
    expect(geo.height / WIDTH).toBeGreaterThan(0.93);
    expect(geo.height / WIDTH).toBeLessThan(0.95);
  });

  it("puts north up: Roraima's anchor is above Rio Grande do Sul's", () => {
    expect(geo.labels.rr![1]).toBeLessThan(geo.labels.rs![1]);
    expect(geo.labels.ac![0]).toBeLessThan(geo.labels.pe![0]);
    expect(Object.keys(geo.labels)).toHaveLength(27);
  });

  it("has borders of all three kinds", () => {
    expect(geo.meshes.municipal.length).toBeGreaterThan(1000);
    expect(geo.meshes.uf.length).toBeGreaterThan(20);
    expect(geo.meshes.outline.length).toBeGreaterThan(0);
  });
});

describe("style", () => {
  it("buckets margins at 10, 25 and 45 points and counting at quarters", () => {
    expect([0, 999, 1000, 2499, 2500, 4499, 4500, 10000].map(marginStep)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect([0, 2499, 2500, 5000, 7500, 9999, 10000].map(countedStep)).toEqual([1, 1, 2, 3, 4, 4, 5]);
  });

  it("colours the real frame: 2,906 PL, 2,663 PT, 2 exact ties, nothing missing", () => {
    const style = styleFrame("lider", frame, geo.ufs, {});
    const sum = (prefix: string) =>
      [...style.buckets].filter(([t]) => t.startsWith(prefix)).reduce((n, [, m]) => n + m.length, 0);
    expect(sum("pl-")).toBe(2906);
    expect(sum("pt-")).toBe(2663);
    expect(style.buckets.get("tie")?.length).toBe(2);
    expect(style.buckets.get("empty")).toBeUndefined();
    expect(style.buckets.get("waiting")).toBeUndefined();
    expect(style.failed).toEqual([]);
    expect(leaderCounts(frame).map((c) => [c.party, c.count])).toEqual([["PL", 2906], ["PT", 2663]]);
    expect(tieCount(frame)).toBe(2);
  });

  it("shows the final frame as 100% counted everywhere", () => {
    const style = styleFrame("apurado", frame, geo.ufs, {});
    expect(style.buckets.get("counted-5")?.length).toBe(5571);
  });

  it("fills each UF with its leader in 'Por estado', and missing UFs as missing", () => {
    const style = styleFrame("estados", frame, geo.ufs, { ba: { party: "PT", marginBp: 3500 }, sp: { party: "PL", marginBp: 900 } });
    const ba = geo.ufs.filter((u) => u === "ba").length;
    const sp = geo.ufs.filter((u) => u === "sp").length;
    expect(style.buckets.get("pt-3")?.length).toBe(ba);
    expect(style.buckets.get("pl-1")?.length).toBe(sp);
    // UFs without a loaded result have no colour of their own: the frame says why (final → empty).
    expect(style.buckets.get("empty")?.length).toBe(5571 - ba - sp);
  });

  it("never colours a municipality that has no data (missing ≠ zero)", () => {
    const S = RESULT_STATUS_CODE;
    const f: MapView = {
      ...frame,
      leader: frame.leader.map((l, i) => (i < 3 ? -1 : l)),
      marginBpCalc: frame.marginBpCalc.map((m, i) => (i < 3 ? null : m)),
      countedBp: frame.countedBp.map((c, i) => (i < 3 ? null : i === 3 ? 0 : c)),
      status: frame.status.map((s, i) => [S.not_published, S.no_sections, S.fetch_failed, S.counting][i] ?? s),
    };
    const lider = styleFrame("lider", f, geo.ufs, {});
    expect(lider.tokenOf.slice(0, 3)).toEqual(["waiting", "empty", "waiting"]);
    const apurado = styleFrame("apurado", f, geo.ufs, {});
    expect(apurado.tokenOf.slice(0, 4)).toEqual(["waiting", "empty", "waiting", "empty"]);
  });

  it("keeps a failed municipality's last colour and marks it for the hatch", () => {
    const f: MapView = { ...frame, status: frame.status.map((s, i) => (i === 10 ? RESULT_STATUS_CODE.fetch_failed : s)) };
    const style = styleFrame("lider", f, geo.ufs, {});
    expect(style.failed).toEqual([10]);
    expect(style.tokenOf[10]).toMatch(/^(pt|pl)-/);
  });
});

// --- The per-UF maps (TASK-visual-pass-2.md §5 item 1) ------------------------------------

describe("per-UF map styles", () => {
  const ufs = [...new Set(geo.ufs)].sort();
  const senate = ufs.map((uf) => senateCell(uf, LegislativeUfView.parse(realView(`legislative/senate/${uf}`))));
  const benches = ufBenches(LegislativeBrView.parse(realView("legislative/federal-deputy/br")));

  it("fills every municipality with its UF's colour and splits exactly the mixed senate UFs", () => {
    const cells = Object.fromEntries(senate.map((c) => [c.uf, c]));
    const style = styleCells(geo, cells);
    for (let i = 0; i < geo.count; i++) expect(style.tokenOf[i]).toBe(cells[geo.ufs[i]!]!.token);
    const mixed = ufs.filter((uf) => {
      const [a, b] = senateElected(LegislativeUfView.parse(realView(`legislative/senate/${uf}`)));
      return a!.party !== b!.party;
    });
    expect(style.splits!.map((s) => s.uf).sort()).toEqual(mixed);
    expect(cells.ba!.label).toBe("PT ×2");
  });

  it("splits a two-way tie for the largest bench and labels the seats", () => {
    const ac = benchCell(benches.find((b) => b.uf === "ac")!);
    expect([ac.token, ac.split]).toEqual(["party-pp-4", "party-uniao-4"]);
    const sp = benchCell(benches.find((b) => b.uf === "sp")!);
    expect([sp.token, sp.split, sp.label]).toEqual(["party-pl-4", undefined, "PL 19/70"]);
  });

  it("draws a selected UF by municipality and fades the others", () => {
    const rj = MunicipalityView.parse(realView("municipalities/governor/rj"));
    const overlay = municipalOverlay(geo, rj);
    expect(overlay.tokenOf.size).toBe(92);
    const cells = Object.fromEntries(ufs.map((uf) => [uf, { uf, token: "party-pl-4" as const, label: "", party: "PL", lines: [] }]));
    const style = styleCells(geo, cells, overlay);
    geo.ufs.forEach((uf, i) => {
      if (uf === "rj") expect(style.tokenOf[i]).toBe(overlay.tokenOf.get(i));
      else expect(style.tokenOf[i]).toBe("party-pl-1");
    });
    const first = [...overlay.tokenOf.keys()][0]!;
    expect(overlay.describe(first)!.lines.join(" ")).toMatch(/lidera com \d+,\d+%/);
  });

  it("mixes a step the way CSS color-mix(in srgb) does", () => {
    expect(mixHex("#c62828", "#ffffff", 1)).toBe("#c62828");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
