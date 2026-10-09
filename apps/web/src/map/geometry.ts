import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiLineString, Position } from "geojson";
import { z } from "zod";

// Decoding the committed geometry (TASK-map.md §2.2). Pure, so it's tested in Node; the
// browser turns the flat arrays into Path2D objects (paths.ts).

/** The parts of the file we rely on; the hash check (fetchVerified) covers the rest. */
export const GeoFile = z.looseObject({
  type: z.literal("Topology"),
  arcs: z.array(z.unknown()),
  transform: z.object({ scale: z.tuple([z.number(), z.number()]), translate: z.tuple([z.number(), z.number()]) }),
  objects: z.object({
    municipios: z.object({ type: z.literal("GeometryCollection"), geometries: z.array(z.unknown()) }),
  }),
  apuracao: z.object({
    v: z.literal(1),
    source: z.string(),
    index: z.string().regex(/^[0-9a-f]{64}$/),
    labels: z.record(z.string(), z.tuple([z.number(), z.number()])),
  }),
});
export type GeoFile = z.infer<typeof GeoFile>;

type Topo = Topology<{ municipios: GeometryCollection<{ uf: string }> }>;

/** Map units: x from 0 to WIDTH, y downward, the projection's aspect ratio kept. */
export const WIDTH = 1000;

export interface Geometry {
  /** sha256 of the ordered ids: must equal MapView.index. */
  index: string;
  count: number;
  /** IBGE `cdi`, in the MapView order. */
  ids: string[];
  ufs: string[];
  /** Per municipality, its rings as flat [x0, y0, x1, y1, …] in map units. */
  rings: Float32Array[][];
  /** minX, minY, maxX, maxY per municipality (4 × count). */
  bbox: Float32Array;
  /** Lines between municipalities of the same UF, between UFs, and the outline. */
  meshes: { municipal: Float32Array[]; uf: Float32Array[]; outline: Float32Array[] };
  /** A point inside each UF (pole of inaccessibility), in map units. */
  labels: Record<string, [number, number]>;
  height: number;
}

export function decodeGeometry(file: GeoFile): Geometry {
  const topo = file as unknown as Topo;
  const obj = topo.objects.municipios;
  // topojson-client applies the file's transform: coordinates come out in projected metres.
  const fc = feature(topo, obj);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of fc.features) {
    forEachPosition(f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [], (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  }
  const k = WIDTH / (maxX - minX);
  const tx = (x: number) => (x - minX) * k;
  const ty = (y: number) => (maxY - y) * k; // projected y grows north; canvas y grows south

  const n = fc.features.length;
  const ids: string[] = [];
  const ufs: string[] = [];
  const rings: Float32Array[][] = [];
  const bbox = new Float32Array(n * 4);
  fc.features.forEach((f, i) => {
    ids.push(String(f.id));
    ufs.push(f.properties.uf);
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const out: Float32Array[] = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const flat = new Float32Array(ring.length * 2);
        ring.forEach((p, j) => {
          const x = tx(p[0]!), y = ty(p[1]!);
          flat[j * 2] = x;
          flat[j * 2 + 1] = y;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        });
        out.push(flat);
      }
    }
    rings.push(out);
    bbox.set([bx0, by0, bx1, by1], i * 4);
  });

  const lines = (m: MultiLineString) => m.coordinates.map((line) => flatten(line, tx, ty));
  type Props = { uf: string } | null;
  const ufOf = (g: unknown) => ((g as { properties: Props }).properties?.uf ?? "");
  const meshes = {
    municipal: lines(mesh(topo, obj, (a, b) => a !== b && ufOf(a) === ufOf(b))),
    uf: lines(mesh(topo, obj, (a, b) => a !== b && ufOf(a) !== ufOf(b))),
    outline: lines(mesh(topo, obj, (a, b) => a === b)),
  };

  const labels = Object.fromEntries(
    Object.entries(file.apuracao.labels).map(([uf, [x, y]]) => [uf, [tx(x), ty(y)] as [number, number]]),
  );
  return { index: file.apuracao.index, count: n, ids, ufs, rings, bbox, meshes, labels, height: (maxY - minY) * k };
}

function flatten(line: Position[], tx: (x: number) => number, ty: (y: number) => number): Float32Array {
  const flat = new Float32Array(line.length * 2);
  line.forEach((p, j) => {
    flat[j * 2] = tx(p[0]!);
    flat[j * 2 + 1] = ty(p[1]!);
  });
  return flat;
}

function forEachPosition(polys: Position[][][], fn: (x: number, y: number) => void) {
  for (const poly of polys) for (const ring of poly) for (const p of ring) fn(p[0]!, p[1]!);
}
