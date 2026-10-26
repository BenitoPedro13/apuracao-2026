# TASK: "Ao longo da apuração" — the 2nd round's count curve, with 2022 dashed

Requested by the user on 2026-10-25 (election day), from a screenshot of the reference
site: one line per candidate (Lula red, Flávio blue), **x = % of sections totalized
(0 → 100%)**, **y = share of valid votes (44% → 56%)**, end labels (51,7% / 48,3%), a
marker where the lines cross, and the 2022 2nd round (Lula × Bolsonaro) as dashed lines.
This is the "Timeline" item of `TASK-implementation-plan.md` Phase 5, which was cut on
10-21. The scrubber stays out of scope.

> **Status (2026-10-25, night):** built and verified (§6). The site part ships with the
> first push after the freeze (10-26 12:00 BRT). Before that, rebuild the 2026 series on the
> final count:
> `pnpm exec node scripts/build-count-timeline.ts --epoch 6258 --days 2026-10-25,2026-10-26`.
> The committed file stops at 21:16:40, at 99.79% of sections.

## 1. Current scenario

- The **Timeline projection** (`architecture.md` §5.3: one point per accepted version of
  the national president file) was specified but never built. `contracts` has no timeline
  type (`architecture.md` line 644: "Deferred: TimelineChunk"), and the projector
  publishes only the current state per `seq`.
- **The raw log already has everything the 2026 curve needs:** the recorder stores every
  distinct version of the 2nd round's `br-c0001-e{epoch}-u` byte for byte (invariant 2),
  each with the TSE's `dg/hg` (totalization instant), `pst` (% sections totalized) and
  per candidate `vap`/`pvap`. `[VERIFY: the 2nd round's epoch code and that tonight's
  versions are in raw/ + obs/, by listing them on 10-26]`
- **2022:** the TSE's `Historico_Totalizacao_Presidente_BR_2T_2022.zip` (research 03 §4)
  is still served: `HEAD https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/Historico_Totalizacao_Presidente_BR_2T_2022.zip`
  → 200, `last-modified: Tue, 01 Nov 2022 20:01:54 GMT`, `etag: "c97bc-5ec6e320fb080"`
  (checked 2026-10-25). Not yet downloaded or parsed. `[VERIFY: column names of the 2T
  CSV (1T has `LULA_QT_VOTOS_TOT_ACUMULADO`…, % sections totalized), the leiame's time
  zone, sample into docs/research/samples/hist/]`
- **Today is the 2nd round and deploys are frozen** (10-24 → 10-26 12:00 BRT,
  `TASK-ci-deploy.md`). The projector runs live, so nothing here touches the live path
  before the freeze lifts.

## 2. Planned changes

### 2.1 `scripts/build-count-timeline.ts` (offline, from the raw log)

`pnpm exec node scripts/build-count-timeline.ts --epoch <2T epoch>` lists the observations
of `br-c0001-e{epoch}-u` in `obs/`, reads each distinct blob from `raw/` (verified against
its key), parses it with the existing `@apuracao/contracts` president file schema, and
emits one point per distinct version, ordered by TSE instant (`dg/hg`, ties by `idg`, as
the fold does since 93bbdad):

`{ at (TSE instant, ISO), observedAt, pst, sections, sectionsTotal, valid,
   votes: { [n]: number } }`

Shares are computed from votes in the UI, not stored. A gap between observations
longer than 3 min (§5.3) becomes an explicit `{ gap: true }` marker. The script asserts:
`pst` non-decreasing, every vote count non-decreasing, and the last point equal to the
final file's numbers.

The same script reads the 2022 zip (`--with-2022 <path to zip>`, downloaded once into
`.capture/hist/`, sha256 recorded) through a parser in `packages/tse/src/odsele.ts`'s style
(by header name, Latin-1, `;`), keeping Lula (13) and Bolsonaro (22) cumulative votes and
% sections per row. Its last row must equal the 2022 2nd round's published final result
(Lula 60.345.999, Bolsonaro 58.206.354 `[VERIFY: against the TSE's 2022 final file, not
from memory]`).

### 2.2 Contract `CountTimeline` (`packages/contracts/src/views/timeline.ts` + test)

```
{ v: 1, kind: 'count-timeline', office: 'president', year, round,
  source: { kind: 'tse-feed-observed' | 'totalization-history', files: [...], builtAt },
  candidates: [{ n, name, party }],
  points: ({ at, pst, sections, sectionsTotal, valid, votes } | { gap: true, from, to })[] }
```

One object for 2026-2T, one for 2022-2T. **Changed while building:** they ship with the
site like the history files (`apps/web/public/timeline/count-<year>-<n>t.<sha8>.json`, named by
the generated `apps/web/src/timeline/timeline-files.ts`), not through a bucket index. So the
series need no bucket write, and CI deploys them with the site. Expected size: ~1 point/min over ~4 h ≈ 250 points (2026) and ~8,000
rows thinned to the distinct `pst` steps of 0.01% (2022, ≤ 10,000 points, `[VERIFY:
measured gzip size; thin to every 0.1% of sections if over 100 KB]`).

### 2.3 Web: `components/over-the-count.tsx` + `hooks/use-count-timeline.ts`

- `useCountTimeline()` wraps one `queryOptions` factory per object (index → objects),
  like `use-history.ts`. It computes each candidate's share of valid votes per point.
- The chart is hand-written SVG in the style of `history/line-chart.tsx`, but with a
  **numeric x** (% of sections, 0–100): a sibling `components/count-chart.tsx`, because
  `LineChart` draws a dot and a hover strip per point (991 points for 2022).
  - y range: 44–56% by default, widened to fit the data in steps of 4 points.
  - **Steps between points, no interpolation** (invariant 1). Gaps are breaks in the line.
  - End labels with name + % (colour is never the only cue, invariant 7). 2022 is dashed
    and named in the legend ("2022: Lula × Bolsonaro").
  - Crosshair on hover/keyboard focus (as `LineChart` does) showing both years' values at
    the same % of sections, each at the last observed point at or before it.
  - Crossing marker only where the lead actually changed between two observed points,
    placed at the first point after the change (not at an interpolated crossing).
- **Table alternative** (invariant 7): a `<details>` "Ver em tabela" listing, at 10, 20 …
  100% of sections, each candidate's share at the last point at or before it (the same
  rule as the line and the crosshair). Past the last point it shows "—".
- y range: symmetric around 50%, in steps of 4 points, fitted to the points past 5% of
  sections (46–54% tonight). Earlier points are clipped, and the table and crosshair still
  read them.
- The crosshair is a `role="slider"` (arrows ±1%, Shift ±10%, Home/End, Esc), and its
  `aria-valuetext` reads every series.
- Labels: "Totalização do TSE, como a registramos" (2026) and "Histórico de totalização
  do TSE" (2022). Below the chart: "Até hh:mm (horário de Brasília)" from the last point.
- Placed in the president page's side column, above the turnout panel, as in the
  reference. Hidden when the index has no 2026-2T object (1st-round pages, other offices).

### 2.4 Rejected

- **Adding the Timeline projection to the live projector today:** it would be the right
  long-term home (live curve, per-`seq` chunks) but means changing the critical path
  mid-count, against the freeze. It can follow later, rebuilt from the same raw log
  (replay is a test), and replace §2.1's object.
- **Accumulating points in the browser while the page is open:** each viewer would see a
  different curve, starting whenever they arrived, and nothing would trace back to a file.
- **Drawing the 1st round instead of 2022:** its curve can only come from BU receipts
  (`TASK-bu-timelines.md`), a different source with a different x. That comparison stays
  in that task.
- **The "O vencedor aparece quando a conta não pode mais virar" note** in the screenshot:
  a separate feature (mathematical decision), not part of this chart.

## 3. Why

It shows how the night unfolded, traced to the TSE's own files, and it reuses what was
built for the night (raw log, content-addressed publishing, chart conventions) without
touching ingestion. Cost: ~1 day (script + contract ~½, chart + table + tests ~½). It ships
after the freeze lifts (10-26 12:00 BRT): the site via CI, the two data objects published
by the user (bucket writes are the user's, after a `--dry-run`).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/build-count-timeline.ts` | new | §2.1 |
| `packages/tse/src/odsele.ts` (+ test on a real excerpt) | edit | 2022 totalization-history parser |
| `docs/research/samples/hist/` | new sample | excerpt of the 2022 2T history CSV |
| `docs/research/03-…` §4 | edit | 2T file columns, time zone, size |
| `packages/contracts/src/views/timeline.ts` (+ test), `index.ts` | new / edit | §2.2 |
| `apps/web/src/hooks/use-count-timeline.ts` | new | §2.3 |
| `apps/web/src/components/over-the-count.tsx` | new | §2.3 |
| `apps/web/src/components/history/line-chart.tsx` | maybe edit | numeric x, if it fits |
| president page composition | edit | place the panel |
| `apps/web/e2e/` | new test | panel, table, keyboard crosshair, axe |
| `README.md`, `docs/architecture.md` §5.3/§6.3, `CLAUDE.md` status | edit | §3 of the workflow |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green.
2. Script on the real raw log: every series non-decreasing, `pst` non-decreasing, last
   2026 point equals the final `br-c0001` file's votes per candidate and sections; last
   2022 row equals the TSE's 2022 final result. Run twice → byte-identical object (same
   sha), so it's idempotent.
3. Parser test on the real 2022 excerpt in `samples/hist/`.
4. Playwright: the panel renders both years. The end labels match the headline's
   percentages. The table has 10 rows per year. Arrow keys move the crosshair. axe finds
   no violations. The panel is absent on `?cargo=` other offices and on 1st-round epochs.
5. Spot check: the 2022 curve shows Lula passing Bolsonaro during the count
   `[VERIFY: the % of sections at the lead change, from a contemporary source]`.

## 6. Results (2026-10-25)

- `pnpm turbo run lint check-types test build`: 38/38 tasks green. New unit tests: the parser on
  the real 2022 excerpt (`packages/tse/src/odsele.test.ts`), the contract
  (`packages/contracts/src/views/timeline.test.ts`), and the builder on the real 1st-round
  national file plus the 2022 excerpt (`packages/views/src/timeline.test.ts`, which covers
  generation order, dedupe, idempotency and gaps).
- `build-count-timeline.ts`:
  - 2022: 5,286 rows → 991 points, 20 KB gzip, ending on 472,075/472,075 sections and
    Lula 50.90% × Bolsonaro 49.10%. The script checks this against the archive's final votes.
  - 2026 (read-only on the raw bucket, 2,805 segments from 8 recorders): 127 stored versions
    of `br-c0001-e006258-u`, all valid, giving 124 points and 0 gaps. The first point is
    16:46 with 0 valid votes, which isn't drawn. The last is 21:16:40, at 498,188/499,248
    sections, Lula 51.76% × Flávio 48.24%. Lead changes at 13.98% and 48.42% of sections.
  - Running it twice gives the same sha.
- The §5 item 5 spot check comes from our own data: in 2022, Lula passes Bolsonaro for good
  at 66.79–67.59% of sections (18:42:54–18:43:50, three flips). `[VERIFY: against a
  contemporary report]`
- Playwright `e2e/over-the-count.spec.ts`: 2/2. It checks the end labels, the 10-row table
  ending on 2022's 50,9% / 49,1%, the keyboard slider at 50%, axe with 0 violations on the
  panel, and that the panel is absent for governors. Screenshots were checked at 1440 px and
  390 px in dark mode, with no horizontal scroll and no console errors.
