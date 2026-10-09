# TASK: visual pass 2: Governadores, a map on every office, seat charts

Phase 3 polish of `TASK-implementation-plan.md`, asked for by the user on 2026-10-09: "não
sei se usando nossa agência criativa para desenvolver componentes que ajudem os usuários a
visualizar os dados de forma mais intuitiva e insightful … eu não vejo o mapa em todas as
views, só em presidente". Approved the same day ("sim e pode implementar"), in this order:
Governadores, the legislative maps and the two bugs, then the seat charts. Phase 3 closes
on Sun 10-18; nothing here touches the projector, the contracts or the recorder.

## 1. Current scenario (screenshots of the live site, 2026-10-09, 1440 and 375 px, light)

Compared with the reference screenshots in `docs/refs/` (`research/04` §2):

1. **There is no Governadores tab.** The projector publishes `result/governor/{uf}` and
   `municipalities/governor/{uf}` for the 27 UFs in the 1st round (198 views in the live
   manifest, 54 of them governor), and will publish them for the **7 runoffs** (AC, AM, DF,
   ES, RJ, RN, TO) on 10-25: the only thing besides the president on the night. The site
   never reads them. The 1st round's views carry the TSE's outcome per candidate:
   `situation` is `Eleito` (20 candidates), `2º turno` (14) or `Não eleito` (150).
2. **Only the president has a map.** Senado, Câmara and Assembleias show bars and tables.
   Their data is per UF only (the recorder keeps the 81 UF files, `TASK-legislative-archive.md`
   §2.1), which is enough for a map by state.
3. **"Disputa por estado" is half a screen of white** until a UF is picked from a `<select>`
   ("Escolha…"). Nothing invites the pick, and nothing is shown meanwhile.
4. **The composition has no shape.** Bars are grey except PL and PT; the per-UF table is a
   run-on text list (`PL 2 · UNIÃO 2 · MDB 1 · …`) with a dotted underline under every
   number.
5. **Bugs:** at 375 px the president's "Por estado" table is 512 px wide (`min-w-[32rem]`),
   so the % and Apurado columns are off-screen with no cue that the table scrolls.

## 2. Planned changes

### 2.1 Party palette (`app/globals.css`, `lib/party.ts`)

Eight parties get their own colour, by national weight in the 1st round (seats in the
Câmara and Assembleias): **PL** blue, **PT** red (unchanged), **UNIÃO** teal, **PSD**
orange, **PP** violet, **REPUBLICANOS** magenta, **MDB** olive, **PODE** ochre. Every
other party stays the neutral `--party-other`. Same party, same colour, on every office.
- `--party-<key>` per theme; each **≥ 4.5:1 against `--panel`** in its theme (it's also used
  as text), checked by a unit test that computes the WCAG ratio from the CSS.
- The map's steps for any party are mixes of that colour with `--panel` in sRGB (25/50/75/
  100%), computed in JS for the canvas and with `color-mix(in srgb, …)` in CSS for the
  legend, so both agree.
- No green (the urna's CONFIRMA is the only green, `TASK-visual-identity.md` §2.5), no
  yellow-green pair that reads as the flag. The sigla is printed next to every coloured mark
  (invariant 7).

### 2.2 The map, generalized (`map/style.ts`, `map/renderer.ts`)

- Fill tokens gain `party-<key>-<1..4>` (resolved from `--party-<key>`), `none` (flat: no
  race in this UF this round) and keep `tie`/`empty`/`waiting`.
- **Splits:** a style may list UFs drawn in two colours, split along the UF's bounding-box
  diagonal (the senate's two elected; a tie for the largest bench). The renderer clips to
  the UF's own outline, so the split never leaks.
- `MapStage` stays the president's. A new `UfMapStage` (`components/map/uf-map-stage.tsx`)
  draws any **per-UF model**: labels (two short lines per UF), the small states' call-outs,
  hover card, click/tap to select the UF, zoom buttons. It reuses `MapRenderer`,
  `useMapRenderer` and the call-out geometry, which move into a shared module.

### 2.3 Governadores (`?cargo=governador`)

Layout like the president's (same grid): left the race summary, centre the map, right the
selected UF; below, the UF table and the municipality table.
- **Summary (left):** "27 disputas · 20 eleitos no 1º turno · 7 no 2º turno" (counts of the
  TSE's own `situation`, labelled as our count); a **27-tile grid** (UF sigla on the leader's
  colour, with the leader's party in text and "2º t." when it goes to a runoff), each tile a
  button that selects the UF; **"Disputas mais apertadas"**: the 8 races with the smallest
  difference between the top two (ours, `difference()` over `vvc`, labelled), each with both
  candidates, the TSE's % and the outcome; "Ver todas" opens the rest.
- **Map:** each UF in its leader's colour; strong (step 4) when the TSE says `Eleito`, light
  (step 2) when it goes to the 2nd round or is still counting; `none` (flat, legend "Sem 2º
  turno neste estado") for UFs absent from the round. Label: sigla + "PSD 63,96%". With a UF
  selected, **its municipalities** are drawn from `municipalities/governor/{uf}` (leader
  colour, 4 margin steps as the president's map; ties hatched); the other UFs keep their
  state colour.
- **Selected UF (right):** the headline component, generalized (`office`, `area`, title):
  the two leaders, their TSE %, votes, outcome, difference, others, turnout/blank/null. With
  no UF selected: the closest race is shown, labelled as such.
- **Tables:** "Por estado" (leader, %, outcome, apurado; row selects the UF) and "Por
  município" for the selected UF (the president's table, given `office`). The round
  selector shows on Governadores too; in the 2nd round only the 7 UFs have rows.

### 2.4 Senado, Câmara, Assembleias

- **Map by state**, with a one-line note that these offices are kept per state, not per
  municipality.
  - **Senado:** each UF split between the parties of its two elected (solid when both are
    the same party); label "PL · PP".
  - **Câmara / Assembleias**, two modes: **"Maior bancada"** (the party with most seats in
    the UF; a two-way tie is split, three or more is the hatched tie; label "PL 21/53") and
    **"Um partido"** with a party picker (default the largest): the party's share of the UF's
    seats in 4 steps (< 10%, 10–25%, 25–40%, ≥ 40%; 0 seats is flat "nenhum eleito"); label
    "21/53".
  - Clicking a UF (map, call-out chip or table row) selects it; the map is the picker.
- **Composition:** a **hemicycle** of dots for the Senado (54) and the Câmara (513), the 8
  palette parties in seat order and the rest grouped as "Outros", above the existing bars
  (now in party colours; they stay the screen-reader table). Assembleias keep bars only:
  1,059 seats in 27 houses aren't one chamber, and a hemicycle would say they were.
- **"Disputa por estado"** appears only with a UF selected, right under the map, with a
  "Fechar" button; with none, the right column shows the highlights instead:
  - Câmara and Assembleias: **"Mais votados do Brasil"**, top 10 across the 27 UF files
    (the order is ours, labelled; votes and situation are the TSE's).
  - Senado: **"Disputas mais apertadas"**: per UF, the last elected against the first not
    elected, the 5 smallest differences in votes (ours, labelled).
- **Per-UF table:** a seat strip (segments in party colours, proportional to the UF's seats)
  above the text list. The strip is `aria-hidden`; the text stays the accessible content.

### 2.5 Fixes

- `DataTable` gets `min-w-[32rem]` only from `sm` up, so phone tables wrap instead of
  hiding columns.

### 2.6 Not in this task

- The president map's "Candidato" and "Vantagem" modes need per-candidate shares and vote
  margins in `map/president` (a contract and projector change): a separate task, after the
  Kafka gate.
- Municipality maps for the Senado and deputies: the recorder never captured those files.
- Photos (`[VERIFY: TSE candidate photo URLs and their license]`, research 04), the updates
  feed and the scrubber (timeline task).

### 2.7 Alternatives considered and rejected

- **Generalize `MapStage` itself:** its model is the president's (municipal frame,
  UfSummary, MunicipalityInfo); bending it to UF-level models would put `if (office)` all
  over the stage. A second stage over the same renderer is smaller and leaves the tested
  president map alone.
- **A colour per every party (~30):** indistinguishable hues; past ~8 categories colour
  stops carrying identity. The sigla carries it.
- **Left/centre/right blocs** (the reference): an editorial classification, not TSE data
  (`research/04` §2).
- **A hemicycle for the Assembleias:** see above.
- **An SVG map for the UF-level maps:** a second renderer and a second geometry for the
  same shapes; the canvas already draws UF borders and selection.

## 3. Why

Governadores is the only part of the night besides the president that isn't on the site.
The maps and charts turn tables into answers ("where did PL win seats", "which states
were close") with numbers that are all the TSE's or labelled sums and orderings of them.
Cost: ~2 days of web work, inside Phase 3; no new data, no AWS cost; the first load grows
by the palette CSS only (the new map and charts load with their pages).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/app/globals.css` | edit | `--party-*` palette, both themes |
| `apps/web/src/lib/party.ts` | edit | party → palette key; `partyFill(step)` |
| `apps/web/src/map/style.ts` | edit | party tokens, `none`, splits, UF-level styling helpers |
| `apps/web/src/map/renderer.ts` | edit | dynamic party fills, split UFs |
| `apps/web/src/map/uf-style.ts` | new | pure UF-level models: governor, senate, chambers |
| `apps/web/src/components/map/callouts.ts` | new | call-out placement shared by both stages |
| `apps/web/src/components/map/uf-map-stage.tsx` | new | the per-UF map stage |
| `apps/web/src/components/map/map-legend.tsx` | edit | party swatches |
| `apps/web/src/hooks/use-governors.ts` | new | governor rows, summary, closest races, map model |
| `apps/web/src/hooks/use-legislative.ts` | edit | map models, hemicycle data, highlights |
| `apps/web/src/hooks/use-data.ts` | edit | several legislative UF views at once |
| `apps/web/src/hooks/use-url-state.ts` | edit | `governador` cargo, `?partido=`, chamber map mode |
| `apps/web/src/components/governors/*` | new | section, summary, tiles, closest races, map panel, table |
| `apps/web/src/components/hemicycle.tsx` | new | SVG dots, `aria-hidden` |
| `apps/web/src/components/legislative-*.tsx`, `seat-bars.tsx`, `uf-seats-table.tsx`, `uf-race.tsx` | edit | layout, map, highlights, strips |
| `apps/web/src/components/headline.tsx`, `hooks/use-headline.ts` | edit | `office`/`area`/title props |
| `apps/web/src/components/municipality-table.tsx`, `hooks/use-rows.ts` | edit | `office` prop |
| `apps/web/src/components/cargo-nav.tsx`, `cargo-switch.tsx`, `app/page.tsx` | edit | the new tab and layout |
| `apps/web/src/components/data-table.tsx` | edit | phone min-width |
| `apps/web/test/real/…` | edit | the live `1t-final` manifest + the governor and legislative views the tests read (real files, hash-checked) |
| `apps/web/src/**/*.test.ts` | new | palette contrast, UF styles, hemicycle, governor rows on the real views |
| `apps/web/e2e/governors.spec.ts`, `e2e/legislative.spec.ts` | new / edit | the acceptance criteria below |
| `README.md`, `CLAUDE.md` | edit | status |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green. Unit tests on the real views:
   every palette colour ≥ 4.5:1 on `--panel` in both themes; the governor model on the 27
   real 1st-round views gives 20 `Eleito` UFs, 7 runoffs (AC, AM, DF, ES, RJ, RN, TO) and
   the closest race first; the chamber model gives PL as the largest bench in the UFs where
   the view says so, ties split; the senate model splits exactly the UFs whose two elected
   are of different parties; the hemicycle lays out exactly 513 and 54 dots.
2. e2e against the live bucket (`pnpm --filter @apuracao/web test:e2e`):
   - `?cargo=governador`: 27 tiles, the summary reads "20 eleitos no 1º turno · 7 no 2º
     turno"; `&uf=rj` shows Douglas Ruas 49,27% and Eduardo Paes 42,76%, both "2º turno",
     and the municipality table lists RJ's 92 municipalities.
   - Senado, Câmara, Assembleias: a map with 27 UF labels; clicking SP's label opens
     "Disputa por estado" for São Paulo; "Fechar" closes it; Câmara shows the hemicycle and
     "Mais votados do Brasil" with 10 rows in vote order.
   - axe (WCAG 2.2 AA tags) zero violations and no page-level horizontal scroll on
     Governadores + RJ and Câmara + SP, light and dark, 375 and 1440 px.
   - At 375 px the president's "Por estado" shows the % column without scrolling.
3. Screenshots of every office, 1440 and 375, light and dark, looked at and critiqued
   before calling it done (memory: UI/UX equals engineering); the critique goes in §6.
4. Deploy (user runs it, memory: deploys-run-by-user), then the e2e again against the
   published page.

## 6. Outcome (2026-10-09, built and verified locally; deploy pending, run by the user)

- `pnpm turbo run lint check-types test build` green. Web unit tests 45/45 (new: palette
  contrast from `globals.css`, governor races, chambers, hemicycle, per-UF styles, all on the
  real `1t-final` views now in `apps/web/test/real`, 92 objects, each hash-checked when copied).
- e2e 37/37 against the live bucket, including axe (WCAG 2.2 AA tags) with zero violations
  and no page-level horizontal scroll on Governadores + RJ and Câmara + SP, light and dark,
  375 and 1440 px; the president's "Por estado" now shows its % column at 375 px.
- Found while building: the CSS build drops custom properties whose names exist only
  assembled at runtime (`--party-${key}`, `--map-none`), and minifies `#ffffff` to `#fff`
  (which broke the sRGB mix). Fixed by naming every `var(--…)` in full (`lib/party.ts`) and
  normalizing colours through the canvas; recorded in `CLAUDE.md` (toolchain quirks).
- A zoom asked for before the canvas had a size (`?uf=` on first load) moved the map off
  screen; the renderer now defers it to the first resize.
- **Screenshot critique** (1440 and 375, light and dark):
  - Governadores reads at a glance: 27 tiles (solid = elected, outlined = runoff), the
    closest race (RN, 0,78 point) open by default, the map by state; picking RJ draws its
    92 municipalities (Douglas Ruas's blue inland, Eduardo Paes's orange in the capital
    region and the coast) with the other states faded.
  - Câmara "Um partido · PT" shows what the tables never did: no PT deputy in AM, AC, RO,
    RR, TO or AL, its strongest share in PI. The Senado map's diagonal splits show the two
    seats per state.
  - Left as is: on a phone the municipality table's rows wrap to three or four lines (the
    columns stay visible, the trade the fix chose); the "SE PSD · UNIÃO" call-out touches
    the gutter's edge at 1440 px. Neither hides a number.
