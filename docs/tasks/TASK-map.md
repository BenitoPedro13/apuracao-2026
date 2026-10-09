# TASK: the municipality map (Phase 3, must-have 2)

Phase 3 of `TASK-implementation-plan.md` (Mon 10-12 → **Sun 10-18**, started early on
10-08). `architecture.md` §6.3 (`MapView`, `MapIndexView`), §6.4, §9.3 (map performance
budgets), ADR-10 (Canvas 2D, pre-projected geometry); research 02 §5–6 (the `-cm` index and
the IBGE mesh); research 04 §2 (what the reference site's map does); the user's global
frontend rules. The page around the map (layout, type, palette) is
`TASK-visual-identity.md`; this task is the map itself, its interaction and its states.
**UI/UX carries the same weight as the engineering here (user, 2026-10-08):** every
interaction below has an acceptance criterion, not just the rendering.

## 1. Current scenario

- **The data is published and real.** The 1st round's final manifest has
  `map/president` (5,571 municipalities, columnar: `leader`, `marginBpCalc`, `countedBp`,
  `status`, 84 KB raw) and `map-index/president` (`cdi`, `mu`, `uf`, `name`, 213 KB raw,
  fetched once). Both are now copied into `apps/web/test/real/` (the same hashes as the
  live bucket). In that frame PL leads in **2,906** municipalities, PT in **2,663**, and
  **2** are exact ties (`leader = -1` with votes); the largest margin is 8,013 bp.
- **The geometry doesn't exist yet.** Research 02 §6 measured the IBGE 2025 mesh but left
  `[VERIFY: visual check at 0.4%/1e4]` open, and `architecture.md` §6.2 reserves
  `data/v1/geo/br-mun-2025.{sha8}.topo.json` for it.
- **The page has a placeholder** where the map goes ("O mapa ainda não está disponível…"),
  and the table alternative (UF table + municipality table, `?uf=`) is built.
- **Measured today, before writing this** (so the numbers below aren't guesses):
  - IBGE zip `BR_Municipios_2025.zip`, 237,062,431 B, sha256 `840bbe6f…83bd`
    (downloaded 2026-10-08), CRS SIRGAS 2000 lon/lat, 5,573 features, fields `CD_MUN`,
    `NM_MUN`, `SIGLA_UF`, … Its bounds reach **−28.85° E**: the Trindade and Martim Vaz
    islands (part of Vitória, ES) and the São Pedro e São Paulo archipelago (part of
    Fernando de Noronha), > 1,000 km offshore.
  - `mapshaper 0.7.80` (`-filter` the two RS lake areas, `-clip` east of −31°,
    `-simplify 0.4% weighted keep-shapes`, `-proj` Albers, `-o topojson
    quantization=10000`): **5,571 features, 1,371,439 B raw, 325,225 B gzip -9**, built in
    13 s. Sorted by `CD_MUN`, the ids equal the TSE `-cm` sample's 5,571 `cdi` exactly,
    and **sha256(ids joined by "\n") = `d0a3d601…ad2c`, the same `index` hash the
    published `map/president` carries.** So the geometry and the data line up by
    construction, and a mismatch is detectable.
  - Visual check at 0.4% / 1e4, rendered to PNG: the national silhouette and the SP
    municipalities at state zoom stay legible. **The `[VERIFY]` resolves: accepted.**
  - npm (2026-10-08): `mapshaper` 0.7.81 is a day old (refused by pnpm's
    `minimumReleaseAge`), so 0.7.80; `d3-zoom` 3.0.0, `d3-selection` 3.0.0,
    `topojson-client` 3.1.0 (the d3 ecosystem's stable releases, no newer major).

## 2. Planned changes

### 2.1 Geometry: `scripts/build-geometry.ts` (one-off, reproducible, committed output)

A script, not a hand-run command line, so the geometry is rebuilt identically:

1. Input: the IBGE zip (path argument, default `data/ibge/BR_Municipios_2025.zip`,
   gitignored), checked against its sha256 above. The URL is in the script's header.
2. mapshaper (its Node API, `mapshaper.runCommands`), exactly the measured pipeline:
   `-filter` out `4300001`/`4300002` (lagoas Mirim and dos Patos: no voters; their holes
   read as water) → `-clip bbox=-74.5,-34.5,-31,5.5` (drops the three ocean islands
   above, keeps Fernando de Noronha at −32.4°) → `-simplify 0.4% weighted keep-shapes`
   → `-proj` **Albers equal-area conic centred on Brazil** (`+proj=aea +lat_0=-12
   +lon_0=-54 +lat_1=-2 +lat_2=-22 +ellps=GRS80`: standard parallels at −2° and −22°
   bracket the country; a choropleth compares areas, so an equal-area projection) → keep `CD_MUN` (as the TopoJSON `id`)
   and `uf` (lowercase `SIGLA_UF`) → `-sort CD_MUN ascending` → TopoJSON, quantization
   1e4. mapshaper also emits **UF label anchors** (`-dissolve uf` then `-points inner`, the
   pole of inaccessibility, so a label never falls outside a concave state).
3. Asserts, failing the script: 5,571 features, none empty; ids strictly ascending and
   equal to the `cdi` of the TSE `-cm` sample in `docs/research/samples/`; gzip -9 size
   ≤ 360 KB; 27 label anchors.
4. Output: `apps/web/public/geo/br-mun-2025.{sha8}.topo.json` (sha8 = first 8 hex of the
   file's sha256), with `index` (the sha256 of the ordered ids) and the label anchors
   inside the file, plus a generated `apps/web/src/map/geo-file.ts` exporting
   `{ path, sha256, index }`. Both committed: the build never needs the 237 MB download.

**Where it's served: with the site, not under `data/`** (a change to `architecture.md`
§6.2). The geometry is versioned with the code that draws it, not with the projector's
data; serving it from the site's own origin means one deploy, no second write path into
the bucket, and `next dev` serves it from `public/` with no extra step. `deploy-web.ts`
marks `geo/*.topo.json` (content-hashed names) `immutable`, like `_next/static`.

### 2.2 The renderer: `apps/web/src/map/` (framework-free, then a thin React leaf)

- **`geometry.ts`** (pure): decodes the TopoJSON with `topojson-client` into, per
  municipality, its rings in projected units with **y flipped** (projected y grows north,
  canvas y south), its bounding box and its `uf`; plus three meshes: municipal borders
  (`mesh` where both sides are the same UF), UF borders (both sides differ) and the
  outline (exterior arcs). Unit-tested in Node (no `Path2D` there).
- **`paths.ts`** (browser): one `Path2D` per municipality and per mesh, built once.
- **`style.ts`** (pure): the fill for every municipality from (mode, `MapView`, UF
  results, palette). **Fills are grouped into buckets** (a party × an intensity step, or a
  % step, plus the no-data and tie states), so a frame is ~12 combined paths. Returns
  bucket → municipality indexes; the counts are unit-tested against the real frame.
- **`renderer.ts`** (browser, imperative, owns the canvas): `setFrame(buckets)` builds one
  combined `Path2D` per bucket (`addPath`), `setView(transform)`, `setHover(i)`,
  `draw()`. A draw is ~12 fills + 3 strokes. Line widths are divided by the zoom so borders
  stay hairlines. Canvas pixels = CSS size × `devicePixelRatio` (capped at 2).
  **Missing ≠ zero on the map (invariant 6):** `no_sections` is a flat neutral,
  `fetch_failed`/`not_published` are a neutral with a **diagonal hatch** (a canvas
  pattern), a tie is a third pattern; never a party colour.
- **Hit-testing: a bbox grid + `isPointInPath`**, not ADR-10's off-screen picking canvas.
  A 64 × 64 grid over the projected bounds lists the municipalities whose bbox touches
  each cell; the pointer is inverted through the zoom transform and tested against those
  few paths on a 1 × 1 context. Exact at borders (a picking canvas antialiases edges into
  wrong colours) and no second full draw per frame.
- **Pan and zoom: `d3-zoom`** on the canvas (the reference implementation of wheel, drag,
  pinch and double-tap gestures, with `scaleExtent` [1, 12] and a `translateExtent` that
  keeps the country on screen). Hand-rolled pointer maths was rejected: pinch, inertia
  edge cases and touch/mouse arbitration are exactly where bespoke code goes wrong.
  Gesture rules (§2.4) are d3-zoom `filter`s.
- **Performance marks:** `performance.mark/measure` around first draw, recolour and each
  zoom frame (`map:first-draw`, `map:recolour`, `map:frame`), read by the perf test. No
  special build.

### 2.3 Data and hooks (global frontend rules: every hook abstracted)

- **`geometryQuery()`** (`queryOptions`): fetches the committed file from the site origin,
  verifies its sha256 (`fetchVerified`, the same check every view gets), decodes it,
  `staleTime: Infinity`. Preloaded from the root layout (`ReactDOM.preload(…, { as:
  "fetch", crossOrigin: "anonymous" })`) so its 325 KB start downloading with the JS, not
  after it.
- **`useMapModel()`**: `useMapFrame()` + `useMapIndex()` + the UF results the UF table
  already loads (`useResults`) → `{ buckets, legend, counts, ufLabels, byIndex(i) }`.
  Refuses to draw if `map.index !== geometry.index` or `map.count !== 5,571` (an error
  state, never misaligned colours). Business rules (margin buckets, labels, "calculado")
  live here and in `style.ts`, not in components.
- **`useMapMode()`**: `?mapa=lider|estados|apurado` (default `lider`), shareable, same
  `replaceState` helper as `?uf=`.
- The selection **is the existing `?uf=`** (`useSelectedUf`): choosing a state on the map
  sets it, which already opens that state's municipality table below. One source of truth.

### 2.4 What the reader sees and does (the UX spec)

**Modes** (a segmented control of native buttons with `aria-pressed`, like the existing
toggles; names are what people recognize):

| Mode | Fill | Legend |
|---|---|---|
| **Quem lidera** (default) | each municipality in its leader's party colour, 4 intensity steps by margin: < 10, 10–25, 25–45, ≥ 45 points (the reference's breaks) | per party: "PL lidera em 2.906 municípios" (our count, labelled "contagem nossa"), the 4 steps, ties, no data |
| **Por estado** | every municipality filled with its UF's leader, intensity by the UF's margin; the UF's TSE % in its label | leader per UF count |
| **Apurado** | % of sections counted: 5 neutral steps (< 25, 25–50, 50–75, 75–< 100, 100%) | the steps, "100% apurado em N municípios" |

"Candidato" (one candidate's share everywhere) and "Vantagem" (spikes sized by vote
margin) need per-candidate columns the map view doesn't carry; they're
`TASK-map-votes.md` (a new `map-votes/president` view in the projector), after this one.

**State labels:** the UF code and its leader's **TSE % string** (from
`result/president/{uf}`), as HTML on top of the canvas (crisp text at any zoom, and
real text for screen readers and translation tools), repositioned on zoom by a transform
(no React render per frame). The small states (RN, PB, PE, AL, SE, ES, RJ, DF) get
**call-outs** in a column beside the coast with a thin leader line, as on the reference,
plus an **Exterior** chip when Exterior is shown. Above 2× zoom the call-outs give way to
in-place labels.

**Hover (pointer) and tap (touch):** a tooltip that follows the pointer, clamped inside
the map: municipality name and UF, the leader with party and the margin in points
("vantagem de 12,3 pontos, calculada"), "% das seções apuradas", or the missing state in
words ("Nenhuma seção apurada", "Falha ao buscar o arquivo do TSE", "Empate exato"). The
hovered municipality gets a 2 px outline. On touch, a tap shows the same card pinned
until another tap or Esc.

**Click / tap on a municipality:** selects its UF (`?uf=`), zooms to that UF (animated
350 ms, instant under `prefers-reduced-motion`), and the municipality table below lists
that UF with the clicked municipality's row highlighted.

**Zoom controls:** `+`, `−` and "Brasil" (reset, shown only when zoomed; it also clears
the selection) as buttons; a native `<select>` "Ir para o estado" with the 27 UFs (the
keyboard and screen-reader route to everything the map does: it selects, zooms and opens
the table). The canvas itself takes no keyboard focus (as built, §6).

**Gestures that don't trap the page:** the mouse wheel scrolls the page; **Ctrl/⌘ +
wheel zooms** (trackpad pinch sends Ctrl + wheel), and a plain wheel over the map shows
a hint for 1.5 s ("Use Ctrl + rolagem para ampliar o mapa"; "⌘" on macOS). On touch, at
the national fit one finger scrolls the page and **a tap picks a municipality and zooms to
its state**; once zoomed in, drag and pinch move the map and "Brasil" resets (as built,
§6). Double-click zooms in.

**Live updates:** a new frame recolours in place (no animation: a vote count shouldn't
"flow"), keeps the zoom, the selection and an open tooltip (whose text updates).

**States** (the map is never blank without a reason):
- Loading: a skeleton of the map's exact box (fixed aspect ratio, so no layout shift),
  "Carregando o mapa…".
- Geometry failed: "O mapa não carregou. Os mesmos resultados estão nas tabelas por
  estado e por município." + a "Tentar de novo" button.
- Index mismatch or a malformed frame: the same, with "O mapa e os dados não
  correspondem; mostrando só as tabelas" (and a console error with both hashes).
- Before any municipality has numbers: the map draws in the "nenhuma seção apurada"
  neutral with that legend; never party colours.

**Accessibility (WCAG 2.2 AA, invariant 7):** the canvas is `role="img"` with an
`aria-label` summarizing the frame ("Mapa por município: PL lidera em 2.906, PT em
2.663, 2 empates; 100% das seções apuradas"); a "Pular o mapa" link before it; the
`<select>`, buttons and the tables are the full keyboard route; colour is never alone
(legend text, hatches for missing data, tooltip text, the tables), which is what makes a
4-step ramp acceptable under WCAG 1.4.11 (adjacent steps can't all reach 3:1 against each
other; the same information is available as text); the strongest step of each party and
every border/outline reach ≥ 3:1 against the background; all motion respects
`prefers-reduced-motion`.

**Responsive:** desktop, the map is the page's centre column (`TASK-visual-identity.md`);
below 1024 px it's full-width after the headline, at the map's aspect ratio (height
0.94 × width, measured); call-outs move under the map as a row of chips on phones < 480 px.

### 2.5 Loading strategy and budgets

- The map is its own **lazy chunk** (`next/dynamic`, `ssr: false`, inside a client leaf),
  per the revised budget (`TASK-web-shell-and-data-hooks.md` §6 item 6): **≤ 35 KB gzip**
  for the chunk (d3-zoom and its d3 deps ≈ 15 KB, topojson-client ≈ 3 KB, ours), outside
  the first load. The first-load JS budget (≤ 260 KB, ≤ 80 KB ours) is unchanged.
- Geometry **≤ 360 KB gzip** (325 KB measured), immutable, preloaded.
- `architecture.md` §9.3, unchanged: first full draw ≤ 50 ms, recolour ≤ 16 ms, pan/zoom
  frames ≤ 16 ms p95, JS heap ≤ 60 MB (Chromium, 4× CPU, mobile viewport, 5 runs,
  median); map drawn ≤ 4 s on Fast 4G.

### 2.6 Alternatives considered and rejected

- **SVG / MapLibre / deck.gl:** ADR-10 stands (5,571 DOM nodes jank; a tile pipeline and
  ~200 KB of WebGL code for a static choropleth).
- **An off-screen picking canvas:** see §2.2 (edge antialiasing, a second draw per frame).
- **Hand-rolled pan/zoom:** see §2.2.
- **Geometry under `data/v1/geo/` in the bucket:** see §2.1.
- **Mercator** (what web maps default to): inflates the South against the North, which
  on a choropleth exaggerates exactly the regional split this election is about.
- **27 focusable UF labels in the tab order:** 27 stops before the tables; the single
  `<select>` does the same job in one stop, and the labels stay pointer targets.

## 3. Why

The map is the second half of the must-have cut ("a live president map", plan §2.1) and
what the reference site leads with; the page is a set of tables without it. The cost:
two small dependencies in a lazy chunk, 325 KB of committed geometry, and one more
download per first visit (cached forever after).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/build-geometry.ts` | new | the reproducible geometry build (§2.1) |
| `scripts/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | edit | `mapshaper` 0.7.80 (dev); its native builds denied with reasons |
| `scripts/deploy-web.ts` | edit | `geo/*` immutable |
| `apps/web/public/geo/br-mun-2025.{sha8}.topo.json` | new | generated, committed |
| `apps/web/src/map/{geo-file,geometry,paths,style,renderer,hit}.ts` | new | §2.2 |
| `apps/web/src/map/*.test.ts` | new | decode, buckets and counts on the real frame |
| `apps/web/src/components/map/*.tsx` | new | the panel, legend, controls, labels, tooltip |
| `apps/web/src/hooks/use-map.ts`, `src/data/queries.ts`, `use-url-state.ts` | edit/new | `geometryQuery`, `useMapModel`, `useMapMode` |
| `apps/web/src/app/{page,layout}.tsx` | edit | the panel replaces the placeholder; preload |
| `apps/web/src/components/municipality-table.tsx` | edit | highlight the municipality chosen on the map |
| `apps/web/e2e/map.spec.ts`, `e2e/perf.spec.ts` | new/edit | §5 |
| `apps/web/test/real/data/v1/o/{map,map-index}` | new | the real published frame and index |
| `docs/architecture.md` §6.2, §6.3, ADR-10 | edit | geometry location, hit-testing, projection |
| `docs/research/02-…md` §6 | edit | the `[VERIFY]` resolved, with the measurements |
| `README.md`, `CLAUDE.md` | edit | status; IBGE attribution in the footer |

## 5. Verification

1. `node scripts/build-geometry.ts`: prints 5,571 features, the index hash
   `d0a3d601…ad2c`, gzip ≤ 360 KB; rerun → byte-identical file (same sha8).
2. `pnpm turbo run lint check-types test build` green. Unit tests on the real frame:
   bucket counts in "Quem lidera" = 2,906 PL + 2,663 PT + 2 ties; decode yields 5,571
   non-empty features in index order; the index check rejects a frame with one `cdi`
   swapped.
3. Playwright against the real data (`serve-data`): the canvas pixel at São Paulo city's
   label anchor has the leader's party fill; hovering a known municipality shows its name,
   leader and "calculada"; the `<select>` choosing "Bahia" sets `?uf=ba`, zooms (the
   "Brasil" reset appears) and the municipality table lists Bahia; a plain wheel scrolls
   the page and shows the hint, Ctrl + wheel zooms; `?mapa=apurado` reloads into that
   mode; a tampered geometry (one byte) shows the error state and the tables still work.
4. axe: **0 violations** in both themes with the map loaded; a Tab walk reaches "Pular o
   mapa", the modes, the zoom buttons and the `<select>`; reduced motion makes the zoom
   instant.
5. Perf (Chromium, 4× CPU, 412 × 915, 5 runs, median): `map:first-draw` ≤ 50 ms,
   `map:recolour` ≤ 16 ms, `map:frame` p95 ≤ 16 ms over a scripted 2 s pan, heap ≤ 60 MB;
   Fast 4G: map drawn ≤ 4 s. The map chunk ≤ 35 KB gzip, the first load unchanged.
6. Screenshots of the three modes in both themes, at 1440 × 1000 and 412 × 915, looked
   at (not just taken) before calling it done.

## 6. Outcome (2026-10-08)

Built as planned, with these changes, each found while building or testing:

- **Touch:** "two fingers pan, one scrolls" isn't buildable on d3-zoom. It tracks each
  touch as it starts, so a filter that rejects the first finger loses it, and the pinch
  never forms. As built: at the national fit, touch is the page's (scroll) and a tap picks.
  Once zoomed in (`k > 1`), d3-zoom takes touch (`touch-action: none`) and the map pans
  and pinches. A tapped municipality's card is a sheet along the map's bottom, since the
  map zooms away from the finger.
- **Keyboard:** no key handling on the canvas. The `<select>`, the zoom buttons and the
  tables already reach everything, and a focusable canvas would be a widget with no
  accessible content. The state labels and call-outs are pointer shortcuts
  (`tabindex=-1`); on phones the call-outs become an in-flow row of real buttons.
- **The canvas's accessible name** is a visually hidden paragraph (the frame's summary)
  next to an `aria-hidden` canvas: `role="img"` on a canvas with handlers is a jsx-a11y
  error, and rightly so.
- **Selection in the URL:** clicking a municipality sets `?uf=` and `?mun=` (its IBGE
  code) in one history entry; the mode is `?mapa=` (`lider` omitted).
- **Call-outs:** RN, PB, PE, AL, SE, **DF**, ES, RJ and Exterior (a globe), in a 116 px
  gutter: 92 px wrapped the TSE % onto two lines.
- **State labels** show the leader's party and TSE % (or the counted % in "Apurado") in
  ink on a translucent panel pill: party-coloured text on its own party's fill was
  unreadable in the first screenshots.
- **Projection aspect:** height = 0.940 × width (Fernando de Noronha widens the box),
  not ≈ 1.02 as first written.
- **A real infra bug, found by the full test run:** the recorder's and projector's Docker
  contexts are the repo root, and `.dockerignore` didn't exclude `data/`, so the IBGE
  download (553 MB) made CDK's asset hashing time the infra tests out. `.dockerignore` now
  excludes `data` and the web's build/test output.
- **The perf suite runs Chrome's new headless** (`channel: "chromium"`): the default
  headless shell rasterizes canvas in software, which doubled the gap between frames
  during a pan (p95 33.4 vs 16.8 ms at 4× CPU; headed Chrome measured 17.8 ms).

### Verification results (§5)

1. `node scripts/build-geometry.ts` twice: 5,571 municipalities, index `d0a3d601…ad2c`,
   `br-mun-2025.5e5c8c26.topo.json`, 1,266,393 B, **306,092 B gzip** (≤ 360 KB), the
   same sha8 both runs. ✓
2. `pnpm turbo run lint check-types test build`: 38/38 tasks. Map unit tests 11/11 on the
   committed geometry and the real frame: 2,906 PL + 2,663 PT + 2 ties, all 5,571
   "100%" in Apurado, missing data never coloured, a failed fetch keeps its colour and
   gets the hatch. ✓
3. Playwright (`e2e/map.spec.ts`, real data): the probe municipality's pixel equals its
   bucket's colour (± 3 per channel) and hovering names it; "Ir para o estado → Bahia"
   sets `?uf=ba`, zooms and lists Bahia; a click sets `?uf=`/`?mun=`; a plain wheel scrolls
   the page and shows the hint, Ctrl + wheel zooms; `?mapa=apurado` opens in that mode;
   a one-bit-tampered geometry shows the error and the 28 UF rows still load; no
   horizontal scroll at 320/375/412/768/1024 px. ✓
4. axe on the map panel with the map drawn, both themes: **0 violations** (4 runs each);
   reduced motion: the zoom to a state is done within 200 ms. The full-page axe runs
   stay in the dashboard spec. ✓
5. Perf (new headless, 4× CPU, 412 × 915, 5 runs, medians): **first draw 17.9 ms**
   (≤ 50), **recolour 8.6 ms** (≤ 16), pan frames **0.7 ms** of JS and **16.7 ms** between
   animation frames p95 (≤ 16 / ≤ 20), heap 27.4 MB (≤ 60; Chrome rounds
   `performance.memory` without a flag). Fast 4G: map drawn **2,702 ms** (≤ 4 s), headline
   1,977 ms. **Map chunk 28.8 KB gzip** (≤ 35); first load 258.4 KB (≤ 260, was 253). ✓
6. Screenshots in both themes at 1440 × 1000 and 412 × 915, critiqued; the fixes above
   (labels, call-outs, headline overlap) came from them. ✓
7. Deploy (run by the user, 2026-10-08): `geo/br-mun-2025.5e5c8c26.topo.json` 200,
   `immutable`, gzip, sha256 equal; pointer ETag unchanged. Headless Chromium on the live
   URL (cold, from NL): map drawn after 7.3 s, summary "PL lidera em 2.906, PT em 2.663,
   2 empates", 0 errors. ✓ The screenshot also showed state labels as "–" while their UF
   results loaded (they now show nothing until loaded; a chip shows "…") and a false red
   freshness alarm (`TASK-web-shell-and-data-hooks.md` §6).
