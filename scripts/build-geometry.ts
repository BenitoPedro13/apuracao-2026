// Build the map geometry from the IBGE municipal mesh (TASK-map.md §2.1). One-off and
// reproducible: the output is committed, so the web build never needs the 237 MB download.
//
//   curl -o data/ibge/BR_Municipios_2025.zip \
//     https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip
//   node scripts/build-geometry.ts [--zip data/ibge/BR_Municipios_2025.zip]
//
// Writes apps/web/public/geo/br-mun-2025.{sha8}.topo.json and apps/web/src/map/geo-file.ts.
// The file is TopoJSON (one object, `municipios`, ids = IBGE `cdi`, ascending) plus an
// `apuracao` member: the sha256 of the ordered ids (the `index` every MapView carries) and
// a label anchor per UF, in the same projected metres as the arcs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..');
const { values } = parseArgs({
  options: { zip: { type: 'string', default: join(ROOT, 'data/ibge/BR_Municipios_2025.zip') } },
});

/** The file downloaded on 2026-10-08 (237,062,431 B); a different mesh is a different map. */
const ZIP_SHA256 = '840bbe6f73726ef9d1460ce49fdfe01a278935c41180d3c893e25ca21db083bd';
/** The two "Áreas Operacionais" of lake water in RS: no voters (research 02 §6). */
const LAKES = ['4300001', '4300002'];
/**
 * East of −31° are only the Trindade/Martim Vaz islands (Vitória, ES) and the São Pedro e
 * São Paulo archipelago (Fernando de Noronha, PE), > 1,000 km offshore; Noronha itself is
 * at −32.4° and stays.
 */
const CLIP = '-74.5,-34.5,-31,5.5';
/** Albers equal-area conic centred on Brazil: a choropleth compares areas. */
const PROJ = '+proj=aea +lat_0=-12 +lon_0=-54 +lat_1=-2 +lat_2=-22 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const SIMPLIFY = '0.4%';
const QUANTIZATION = '10000';
const MAX_GZIP = 360 * 1024;

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const zip = readFileSync(values.zip);
if (sha256(zip) !== ZIP_SHA256) throw new Error(`${values.zip}: sha256 ${sha256(zip)}, expected ${ZIP_SHA256}`);

const tmp = mkdtempSync(join(tmpdir(), 'geo-'));
try {
  execFileSync('unzip', ['-q', values.zip, '-d', tmp]);
  const shp = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.shp'))!);
  const mapshaper = join(ROOT, 'scripts/node_modules/.bin/mapshaper');
  const muns = join(tmp, 'muns.json');
  const labels = join(tmp, 'labels.json');
  // prettier-ignore
  execFileSync(mapshaper, [
    '-i', shp, 'encoding=utf8',
    '-filter', `!${JSON.stringify(LAKES)}.includes(CD_MUN)`,
    '-clip', `bbox=${CLIP}`,
    '-simplify', SIMPLIFY, 'weighted', 'keep-shapes',
    '-proj', PROJ,
    '-each', 'uf=SIGLA_UF.toLowerCase()',
    '-filter-fields', 'CD_MUN,uf',
    '-sort', 'CD_MUN', 'ascending',
    '-rename-layers', 'municipios',
    '-o', 'format=topojson', 'id-field=CD_MUN', `quantization=${QUANTIZATION}`, muns,
    '-dissolve', 'uf',
    '-points', 'inner',
    '-o', 'format=geojson', 'precision=1', labels,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  const topo = JSON.parse(readFileSync(muns, 'utf8')) as {
    objects: { municipios: { geometries: { id: string; type: string | null; properties: { CD_MUN?: string; uf: string } }[] } };
    [k: string]: unknown;
  };
  const geoms = topo.objects.municipios.geometries;
  // `id` carries CD_MUN; drop the duplicate property.
  for (const g of geoms) delete g.properties.CD_MUN;
  const ids = geoms.map((g) => g.id);

  // The order must be the TSE's: the domestic `cdi` of the -cm index, ascending.
  const cm = JSON.parse(readFileSync(join(ROOT, 'docs/research/samples/ele2026_6257_config_mun-e006257-cm.json'), 'utf8')) as {
    abr: { mu: { cdi: string }[] }[];
  };
  const tse = cm.abr.flatMap((a) => a.mu.map((m) => m.cdi)).filter((c) => c).sort();
  if (geoms.length !== 5571) throw new Error(`expected 5,571 municipalities, got ${geoms.length}`);
  if (geoms.some((g) => !g.type)) throw new Error('a municipality lost its geometry');
  if (ids.some((id, i) => i > 0 && id <= ids[i - 1]!)) throw new Error('ids not strictly ascending');
  if (tse.length !== ids.length || tse.some((c, i) => c !== ids[i])) throw new Error('ids differ from the TSE -cm index');

  const points = JSON.parse(readFileSync(labels, 'utf8')) as {
    features: { geometry: { coordinates: [number, number] }; properties: { uf: string } }[];
  };
  if (points.features.length !== 27) throw new Error(`expected 27 UF anchors, got ${points.features.length}`);
  const anchors = Object.fromEntries(
    points.features
      .map((f) => [f.properties.uf, f.geometry.coordinates.map((c) => Math.round(c))] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

  const index = sha256(ids.join('\n'));
  const out = Buffer.from(JSON.stringify({ ...topo, apuracao: { v: 1, source: `IBGE Malha Municipal 2025 (${ZIP_SHA256})`, index, labels: anchors } }));
  const gz = gzipSync(out, { level: 9 }).length;
  if (gz > MAX_GZIP) throw new Error(`${gz} B gzipped, over the ${MAX_GZIP} B budget`);

  const fileSha = sha256(out);
  const name = `br-mun-2025.${fileSha.slice(0, 8)}.topo.json`;
  const geoDir = join(ROOT, 'apps/web/public/geo');
  for (const old of readdirSync(geoDir).filter((f) => f.endsWith('.topo.json') && f !== name)) unlinkSync(join(geoDir, old));
  writeFileSync(join(geoDir, name), out);
  writeFileSync(
    join(ROOT, 'apps/web/src/map/geo-file.ts'),
    `// Generated by scripts/build-geometry.ts; do not edit.\n` +
      `export const GEO_FILE = {\n  path: "geo/${name}",\n  sha256: "${fileSha}",\n  index: "${index}",\n} as const;\n`,
  );
  console.log(`${geoms.length} municipalities, index ${index}`);
  console.log(`${name}: ${out.length} B, ${gz} B gzip -9`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
