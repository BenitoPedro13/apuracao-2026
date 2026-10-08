# TASK: timelines from the TSE's BU files (2026 1st round, 2022 both rounds) and the comparison data

Should-have (`TASK-implementation-plan.md` Phase 5: timeline), extended by the user on
2026-10-08: show the 1st round's night before the 2nd, compare the 2nd round with the 1st
instant by instant, and optionally with 2022. Decision recorded in `CLAUDE.md` (hard
constraint) and `architecture.md` §15 item 9: a sum of BU records is real data when
labelled "boletins recebidos até hh:mm".

> **Update 2026-10-08 (research 03 §4):** the TSE publishes the official **totalization
> history** (per second, per candidate) for 2022's two rounds. For 2022, and for the 2026
> 1st round once it's published (2022's came 16 days after the vote), the curves come from
> that file, labelled as the TSE's totalization; the BU-receipt fold below stays as the
> stand-in until then and as a cross-check after. The contract gains a `source.kind`:
> `totalization-history` | `bu-receipts`.

## 1. Current scenario

- Our raw log holds only the 1st round's **final** files (the recorder started on 10-08),
  so it can't show how the 1st round's night unfolded. fake-tse's replay can't either:
  its rebuilt coverage files are test fixtures, never public (`architecture.md` §9.2).
- The TSE publishes every section's BU (research 03 §1): votes per candidate plus
  `DT_BU_RECEBIDO` (Brasília time, research 03 §2). The **2026 1st round** is published
  (`resultados-2026-boletim-de-urna`, 28 zips, sha512-checked by `scripts/fetch-bweb.ts`),
  and so are **both 2022 rounds** (`resultados-2022-boletim-de-urna`).
- Checked on Acre 2026: the BUs' final sums equal the TSE's `ac` president file (2,270
  sections, blank votes, every candidate) except candidate 28, whose 23 BU votes are
  absent from the result file `[VERIFY: annulled candidacy?]`. Acre's curve spans 141
  distinct minutes (17:08:44 → 20:53:12).
- Nothing publishes historical series, and the views contracts have no timeline type.

## 2. Planned changes

### 2.1 `scripts/build-bu-timeline.ts`

`node scripts/build-bu-timeline.ts --year 2026 --round 1` streams every UF zip in
`.capture/bweb/<year>-<round>t/` (`unzip -p`, Latin-1, president rows only, sections with
`DS_TIPO_URNA` = Apurada counted once), and folds them by **minute of `DT_BU_RECEBIDO`**
into cumulative series, nationally and per UF (+ `zz`):

- `sections` received, of `sectionsTotal` (all "Apurada" sections);
- votes per candidate number, blank (95), null (96), annulled-separately (97);
- `aptos` and `comparecimento` of the sections received (turnout so far).

It then **checks the end of every series against the TSE's final result files**
(2026: our capture `.capture/ele2026-1t`; 2022: the 2022 final files from the TSE feed,
fetched once into `.capture/ele2022-final`, `[VERIFY: the 2022 results feed is still
served, and its paths]`): every candidate's votes and the section count must match per UF
and nationally, and any difference is listed by kind (e.g. annulled candidacies). The
script fails on an unexplained difference.

### 2.2 Contract: `BuTimeline` (`packages/contracts/src/views/timeline.ts`)

```
{ v: 1, kind: 'bu-timeline', office: 'president', year, round,
  label: 'boletins de urna recebidos',            // the UI must show this wording
  closeAt: ISO (17:00 Brasília that day),          // x = minutes since polls closed
  source: { dataset, files: [{ name, sha512 }], builtAt },
  candidates: [{ n, name, party }],
  minutes: number[],                               // ascending, only minutes with a receipt
  br | uf: { sectionsTotal, sections: number[], votes: { [n]: number[] },
             blank: number[], null: number[], aptos: number[], comparecimento: number[] } }
```

One object per (year, round), content-addressed like every view. Expected size ~600
minutes × (28 areas) × (~12 numbers): a few hundred KB raw, far less gzipped; the UI loads
the national series first and a UF on demand (split into `br` and per-UF objects if the
measured size calls for it).

### 2.3 Publishing: `data/v1/historical/index.json`

The series are static, so they're not in the projector's per-`seq` manifests: the script
publishes each object (`data/v1/o/{sha}.json`, immutable, gzipped by `S3Publisher`) and
rewrites a small index `data/v1/historical/index.json` (`max-age=300`) naming them:
`{ "2026-1t": sha, "2022-1t": sha, "2022-2t": sha }`. After the 2nd round, its BU files
(published the next day, as the 1st round's were) add `2026-2t`.

### 2.4 The comparison (data side; the UI is the web task)

- **x axis: minutes since polls closed** (17:00 Brasília in both 2022 and 2026
  `[VERIFY: 2022 used the unified 17:00 Brasília closing]`), so nights line up.
- **On the night:** the 2nd round's live curve is our own timeline of the TSE's published
  totals (projector, should-have #5), the 1st round's is BU receipts. Different sources,
  labelled as such: "totalização do TSE" vs "boletins recebidos". The usable comparison is
  per-instant share of valid votes and % of sections, not raw counts (rounds differ).
- **From 10-26:** the 2nd round's BU files make a BU-vs-BU comparison of the same kind.
- 2022 needs candidate mapping only for display (Lula 13 is in both).

### 2.5 Rejected

- *Publishing fake-tse's replay as the 1st round's timeline:* its coverage files are test
  fixtures (`architecture.md` §9.2); every number would be real, but not their timing as
  published.
- *Interpolating between minutes:* the series only has points where a BU arrived; the UI
  steps between them (invariant 1).
- *Per-section data in the browser* (~500k sections): the per-minute fold is what the
  chart needs.

## 3. Why

It gives the site something true and interesting to show for the two weeks before the 2nd
round (the 1st round's night), and the comparison the user asked for, from data the TSE
already publishes. Cost: ~1 day for the data side; downloads ~5 GB per election round
(2026-1t done; 2022 ~10 GB, kept outside git in `.capture/`). Priority: after the
must-haves (map, web shell); it doesn't block the night.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/build-bu-timeline.ts` | new | §2.1, §2.3 |
| `packages/contracts/src/views/timeline.ts` (+ test) | new | §2.2 |
| `docs/research/03-…` | edit | candidate 28, 2022 checks, measured sizes |
| `README.md`, `docs/architecture.md` §6.2/§6.3 | edit | `historical/index.json`, the view |

## 5. Verification

1. For 2026-1t and 2022-1t/2t: the series' final points equal the TSE's final files per UF
   and nationally (every candidate, sections), with any difference listed and explained;
   `minutes` strictly ascending; every series non-decreasing.
2. Published: `historical/index.json` names three objects, each fetched anonymously over
   HTTPS, gzipped, whose decoded sha256 equals its key and which parses as `BuTimeline`.
3. Spot check against reporting: the 2022 2nd round's well-known lead change (Lula passing
   Bolsonaro during the count) appears in the series `[VERIFY: the reported time, from a
   contemporary source]`.
