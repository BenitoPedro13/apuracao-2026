# TASK: add 2026 to "Eleições anteriores"

Asked by the user on 2026-10-25, the night of the 2nd round: put this election into the history page
(`/historico.html`, `TASK-historical-presidential.md`), so that every question panel, the
year view, the map and "Como a sua cidade votou" cover **1994–2026, nine elections**.

## 1. Current scenario

- The page is built by `scripts/build-history.ts` from the TSE's archive zips
  (`odsele/votacao_candidato_munzona_<year>.zip`, `detalhe_votacao_munzona_<year>.zip`,
  research 05). `HISTORY_YEARS` in `scripts/capture-history.ts` is 1994…2022, and the output
  ships with the site (`apps/web/public/history/`, named in `apps/web/src/history/history-file.ts`).
- **The TSE's 2026 archive already exists** (checked 2026-10-25 with one HEAD each and one
  download of the small zip):
  - `detalhe_votacao_munzona_2026.zip`: 2,511,067 B, `last-modified: Sun, 25 Oct 2026
    15:58:00 GMT`, sha256 `7f6f40a1…a12043`. `_BR.csv` holds **only the 1st round**: 6,292
    president rows (`NR_TURNO` 1, `CD_CARGO` 1), generated 25/10/2026 12:33:24, covering
    5,757 municipality codes, abroad (`ZZ`) included, at 186 rows. It has the same columns
    as 2022 (parse by name, research 05 §3).
  - `votacao_candidato_munzona_2026.zip`: 452,159,174 B, `last-modified: Sun, 25 Oct 2026
    16:16:37 GMT`. Not downloaded yet. `[VERIFY: president rows, 1st round only, the
    _BR.csv name]`
  - **Its 1st-round national sums equal our feed's final `br-c0001-e006257-u` exactly:**
    aptos 158,745,502 = `e.te`, turnout 125,275,835 = `e.c`, abstentions 33,469,244 = `e.a`,
    voters of uninstalled sections 423 = `e.esni`, blank 2,300,798 = `v.vb`, null total
    3,674,249 = `v.tvn`. So the feed → archive field mapping is confirmed nationally.
    `[VERIFY: per municipality, §5 item 2]`
- **The 2026 2nd round isn't in the archive yet.** It only happened tonight. The TSE adds
  rounds by regenerating the zips (research 05 §2), and when the 1st round first appeared
  is unknown `[VERIFY: when the 1st round appeared, e.g. from the capture dates of the
  next regenerations]`. Our raw log, though, holds every 2nd-round municipal file the TSE
  publishes tonight (signed `.jws`, invariant 2), and `.capture/ele2026-1t/` already holds
  the 1st round's 11,443 final files.
- Things that assume eight elections or end at 2022:
  - `HistoryInsights.bellwetherHits` is `max(8)` in `packages/contracts/src/views/history.ts`.
  - The flips compare 2002 with 2022 (`insights.ts` line ~142).
  - `--check` expects 5,570 ids. 2026 has 5,571 municipalities: the map's 5,571 includes
    one created after 2022 `[VERIFY: which code, Boa Esperança do Norte (MT)?]`.
  - The copy says "oito eleições… 1994 a 2022" in `historico/page.tsx`,
    `historico/opengraph-image.tsx` and `history-page.tsx`. `questions.tsx` mostly says
    `{n}` already.

## 2. Planned changes

### 2.1 2026 1st round: the archive, like every other year

- `HISTORY_YEARS` gains 2026. `capture-history.ts` downloads both 2026 zips conditionally,
  as it does for the others, and archives them write-once to `hist/odsele/` with
  `--bucket --write` (user-run).
- `build-history.ts` reads them unchanged: the readers go by header name. One rule to add,
  if it turns out to be needed: a 2026 municipality absent before is `null` in earlier
  years (invariant 6), never 0. The fold already does this per round.

### 2.2 2026 2nd round: our raw log until the archive has it

- `scripts/export-capture.ts --round 2`: the same export for `6258`/`6260`, into
  `.capture/ele2026-2t/`. It is read-only on the bucket, and takes the version the fold
  accepts per path (generation instant, then idg).
- `packages/tse/src/feed-rows.ts` (new, pure): turns one municipal president result file
  (`-u`, `mu` scope, zz included) into the same `DetailRow` and `CandidateRow[]` the archive
  readers produce, one "zone" per municipality, using the mapping confirmed in §1:
  `te → aptos`, `c → comparecimento`, `a → abstencoes`, `esni → naoInstaladas`,
  `vb → brancos`, `tvn → nulos`, and `vap` of candidates whose `dvt` is "Válido" → votes.
  `[VERIFY: a candidate with another dvt; on the 2nd round there are only two]`
- `build-history.ts --feed-2t <dir>`: when the archive has no 2026 2nd-round rows, it folds
  `feed-rows` from that directory instead, and records the source as the feed: per-file
  sha256 digest, file count, newest `dg/hg`. The page labels that round "arquivos de
  divulgação do TSE (assinados); o arquivo oficial de dados abertos ainda não saiu".
- **The switch:** once `capture-history.ts` sees 2nd-round rows in a regenerated 2026
  zip, `build-history.ts` uses the archive and **compares it with the feed build**, per
  municipality and per number. Any difference fails the run and gets explained in
  research 05, as `TASK-bu-timelines.md` did for candidate 28. Then the feed source is
  dropped.

### 2.3 Contracts and insights

- `HistorySource` becomes a union: the existing archive source, or `{ kind: 'tse-feed',
  election, files, digest, generatedAt }`.
- `bellwetherHits` max = the number of decisive rounds, checked in `superRefine`, not a
  literal 8. `mirrorGap` and the other "all N" rules already loop over the years.
- **Flips: 2002 vs the latest year (2026)**, the PT's first win against now, instead of
  2002 vs 2022. `[DECIDE: the user; keeping 2022 is the other option]`
- Rival = best-placed non-PT candidate of the 1st round, as today, so 2026 is Flávio
  Bolsonaro (PL) and rival persistence gains 2022 → 2026.
- `--check` keeps every research 05 number for 1994–2022, which is the regression net. It
  adds the 2026 national 1st-round sums above, and the 2nd round's final national
  numbers from the feed's `br` file. The 9-election insights (universe, bellwethers, mirror,
  landslide 2026, transfers 2026) are recomputed and recorded in research 05 §6 as a dated
  update. Two of them (bellwethers with 9 hits, and the universe) are re-derived by a
  second, independent script, as §6 was.

### 2.4 Web

- The copy goes from "oito eleições presidenciais de 1994 a 2022" to "nove… de 1994 a 2026"
  in `historico/page.tsx`, `opengraph-image.tsx` (the image is regenerated, 1200 × 630) and
  `history-page.tsx`. Question texts that name 2022 as "the latest" read the latest year
  from the data.
- The year view and "Como a sua cidade votou" get 2026 automatically from `years`. The year
  selector and the line charts get a ninth x.
- While the 2nd round comes from the feed (§2.2), its year view carries the source line
  above, and the page footer names both sources.

### 2.5 Rejected

- **2026 entirely from our raw log**, ignoring the archive: the archive is the TSE's
  official open data, and every other year comes from it. The feed is a stand-in for one
  round, for as long as it takes the TSE.
- **Waiting for the archive's 2nd round** before showing 2026: the page would show a
  1st round with no decisive round. That breaks bellwethers, the mirror, the decisive map
  and transfers, or forces a half-2026 state into every insight. It also leaves the page
  behind the night for an unknown number of days.
- **Adding the 1st round alone now:** the same half state, for a gain of one or two days.
- **Mixing 2026 into the live page's views:** the history page stays off the live path
  (invariant 5).

## 3. Why

The page answers "how does this election compare?", and right now it stops at 2022. Both
2026 rounds are real TSE files we already have or can fetch in one download. Cost: about
1 day (adapter + switch ½, contracts/insights/check ½, copy and screenshots). Download: the
452 MB candidate zip once, plus its regenerations, kept conditional. The history files grow
by about 1/8 `[VERIFY: measured gzip of history.json and the largest history-mun-<uf>]`.
It ships after the freeze (10-26 12:00 BRT) once the 2nd round's final files are exported.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/capture-history.ts` | edit | 2026 in `HISTORY_YEARS` |
| `scripts/export-capture.ts` | edit | `--round 2` (6258/6260 → `.capture/ele2026-2t/`) |
| `packages/tse/src/feed-rows.ts` (+ test on real samples) | new | §2.2 mapping |
| `scripts/build-history.ts` | edit | `--feed-2t`, the archive-vs-feed comparison, 2026 checks |
| `packages/contracts/src/views/history.ts` | edit | source union, bellwether max |
| `packages/views/src/history/insights.ts` (+ `history.test.ts`) | edit | flips to the latest year, N elections |
| `apps/web/src/app/historico/page.tsx`, `opengraph-image.tsx`, `components/history/history-page.tsx`, `questions.tsx`, `year-view.tsx` | edit | copy, source line |
| `apps/web/public/history/*`, `src/history/history-file.ts` | regenerated | |
| `apps/web/e2e/history.spec.ts` | edit | 2026 year view, 9 elections |
| `docs/research/05-historical-results.md` | edit | the 2026 files, mapping, 9-election numbers |
| `docs/research/samples/hist/` | new samples | 2026 detail excerpt (1st round), one 2nd-round municipal feed file |
| `CLAUDE.md`, `README.md` | edit | status, the scripts' new flags |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green.
2. **Mapping, per municipality, on the 1st round:** for all 5,757 codes, `feed-rows` over
   `.capture/ele2026-1t/` equals the archive's 2026 detail and candidate rows summed by
   municipality: every count, every candidate. Any difference is listed and explained in
   research 05 before the 2nd round is built from the feed.
3. `build-history.ts --check`: every 1994–2022 number of research 05 unchanged, 2026 1st
   round = the sums in §1, 2026 2nd round = the feed's final `br` file (each candidate's
   votes, aptos, turnout), 5,571 ids with the new municipality null before its first
   election.
4. Rebuild twice → byte-identical files (same sha8 names).
5. Playwright `history.spec.ts`: the year view for 2026 shows both rounds with the TSE's
   final numbers. "Como a sua cidade votou" for São Paulo has a 2026 row. Every
   "nove eleições" text is present, and no "oito" remains. axe finds 0 violations, light and
   dark. The OG image is 1200 × 630.
6. **The switch, rehearsed:** feed a regenerated archive zip with 2nd-round rows (when the
   TSE publishes it) and see the comparison pass, or fail with the differences listed.
