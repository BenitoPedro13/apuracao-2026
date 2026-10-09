# TASK — Senado and Deputados: the 1st-round legislative archive

> Scope change of 2026-10-08 (`TASK-implementation-plan.md` §2.4): Senado and Deputados
> enter on 10-09 as a **1st-round archive**, static final results, nothing live on the 25th
> (the 2nd round elects neither). Written 2026-10-08 (late), before any code.

## 1. Current scenario

- **The recorder never fetched these offices.** Its targets are
  `6257:1` (president) and `6259:3` (governor) (`apps/recorder/src/config.ts`). Senate,
  federal, state and district deputies live in the same state election `6259` as offices
  `5`, `6`, `7`, `8` (`comum/config/ele-c.json`, verified in the sample), and none of their
  files is in the raw log.
- **Projector, views and web know two offices.** `Office = 'president' | 'governor'`
  (`packages/contracts/src/views/common.ts`), `classify()` drops every other path
  (`packages/views/src/model.ts`), and the web page is the president's night only.
- **The site is plan B** (`TASK-public-cdn.md` §8.3): the S3 REST endpoint over HTTPS, which
  has no index documents, so a new route such as `/senado` would not resolve to
  `senado/index.html`. Everything stays on the one page, behind query parameters, as `?turno`,
  `?uf` and `?mapa` already are.

### 1.1 What the TSE publishes (checked 2026-10-08 with `curl`, no `.jws` yet)

Same `-u` shape as president/governor (`carg[] → agr[] → par[] → cand[]`), one file per
UF, no national file (`br-c0005-e006259-u.json` and `br-c0006-…` are **404**):

| Office | `cd` | Files | `nv` (seats) | Size (SP, raw / gzip) |
|---|---|---|---|---|
| Senador | 5 | 27 UFs | 2 per UF, **54** summed | 11 KB / 3 KB |
| Deputado Federal | 6 | 27 UFs | SP 70, **513** summed | 275 KB / 53 KB |
| Deputado Estadual | 7 | 26 UFs (`df-c0007` **404**) | SP 94 | 353 KB / 68 KB |
| Deputado Distrital | 8 | DF only (`sp-c0008` **404**) | 24 | 115 KB / 23 KB |

Per office, what we read:
- `carg[0].nv` = seats; `carg[0].qe` = electoral quotient (deputies only, absent for senate).
- Each candidate has `e` (`"s"` elected) and `st`: senate `Eleito`/`Não eleito`; deputies
  `Eleito por QP`, `Eleito por média`, `Suplente`, `Não eleito`. **Who was elected is the
  TSE's own flag; we compute nothing.**
- `agr[].vag` = seats won by the list (a federation, `tp: "f"`, or a lone party, `tp: "i"`);
  in SP federal it equals the count of `e: "s"` per list on every row, and sums to `nv`.
- Senate candidates carry `vs[]` (1st and 2nd alternates, `tp: s1`/`s2`).
- Party/list vote totals `tvtn`, `tvan`, `tvtl`, `tval` are present;
  `[VERIFY: their exact meaning (nominal / legenda / apurados) in the TSE's EA spec,
  research 01 §6]`. Until then the views carry no party vote totals.
- All 54 files are final: `tf: "s"`, `and: "f"`, `idg` around 2.8 M (SP senate:
  `dg` 05/10/2026 11:44:31).

Sums over the 27 UFs (2026-10-08): **senate 54/54 elected**, PL 19, MDB 7, PT 6, PP 3,
PSB 3, UNIÃO 3, NOVO 3, REPUBLICANOS 2, PSDB 2, PSD 2, PODE 2, REDE 1, PDT 1.
**Câmara 513/513**: PL 121, PT 70, UNIÃO 46, PSD 43, PP 41, REPUBLICANOS 41, MDB 36,
PODE 27, PSB 15, PSOL 14, PCDOB 11, PSDB 11, NOVO 10, PV 7, PDT 6, AVANTE 5, PRD 5,
SOLIDARIEDADE 2, REDE 1, MISSÃO 1. These are the verification numbers in §5. They are
**not yet backed by a signed `.jws` in the raw log**, which is this task's first job.

## 2. Planned changes

### 2.1 Capture: four recorder targets, UF aggregates only

- `apps/recorder/src/config.ts`: the target syntax gains an optional 4th field,
  `election:office:cadence[:uf]`. `uf` = **aggregate-only**: the UF `-u` files, no
  municipality files and no coverage files (the governor target already tracks `6259`'s
  `-ab`). Default targets add `6259:5:600:uf,6259:6:600:uf,6259:7:600:uf,6259:8:600:uf`.
- `apps/recorder/src/targets.ts`: `areasOf()` for offices 5/6 = 27 UFs, 7 = 26 UFs (not
  `df`), 8 = `['df']`; `tier1Files()` skips coverage for `uf` targets and `municipalFile`
  is never called for them; `probePaths()` probes `sp` (`df` for office 8).
- `packages/tse/src/codes.ts`: `OFFICES` gains `senator: 5, federalDeputy: 6,
  stateDeputy: 7, districtDeputy: 8`.
- Load: 81 `.jws` files once (8 s at the 10 req/s budget), then the 600 s soak:
  **+0.135 req/s** against the TSE, still 304s. The soak is the point over a one-off
  script: after a court decision the TSE re-totalizes and the elected list can change, and
  that new version lands in the raw log like any other.
- Deploy: the user runs the recorder's `cdk deploy` (deploys are the user's; I hand over the
  command after `cdk diff`).

### 2.2 Contracts

- `packages/contracts/src/tse/files.ts`: `TseOffice.qe` (int, optional),
  `TseCoalition.vag` (int, optional). Loose objects already pass these files; the fields
  become typed because the views read them.
- `packages/contracts/src/views/legislative.ts` (new):
  - `LegislativeOffice = 'senate' | 'federal-deputy' | 'state-deputy'`. `state-deputy` is
    office 7 in 26 UFs and office 8 in DF; the view keeps the TSE's own name (`nmn`,
    "Deputado Distrital") so the label is never ours.
  - `LegislativeUfView` (`legislative/{office}/{uf}`): `status`, `tse` stamp, `sources`,
    `officeName`, `seats` (`nv`), `quotient` (`qe` or null), `sections`, `electorate`,
    `votes` (the existing blocks), `lists[]` (n, name, type federation/party/coalition,
    parties, `seats` = `vag`), `elected[]` (n, name, party, list, votes, `pct`, `situation`
    `st`) in vote order, and **for the senate only** `candidates[]` (every candidate, with
    alternates `vs`: 13 in SP, so it stays small).
  - `LegislativeBrView` (`legislative/{office}/br`): seats per party **summed by us** from
    the UF views (`calc`, labelled "soma das 27 UFs"), `ufs` = the UFs included, `missing`
    = the UFs without an accepted file. With any missing UF the total is shown as partial,
    never as the chamber's size (invariant 6).

### 2.3 Views and projector

- `packages/views/src/model.ts`: `classify()` maps `6259` offices 5–8 at UF scope to a
  `legislative` role (municipal scope → null); `extractLegislative()` keeps only what the
  views read (the deputy files are ~300 KB parsed, so the compact extract matters for the
  checkpoint).
- `packages/views/src/render.ts`: renders the 81 UF views + 3 `br` views. They exist only
  when `ViewsConfig.legislative` is true, which the projector sets when the state election
  is a 1st round (`6259`): the `2t-1` epoch never has empty legislative views.
- `packages/views/src/reconcile.ts`: per UF, `Σ vag = nv = count(e = "s")`; any mismatch
  is logged like the existing 56 sums, and the view still publishes the TSE's flags.
- Re-seed, run by the user: `projector rebuild --source s3 --epoch 1t-final` (the log has
  grown, so it lands past `seq` 11,387 and the pointer moves forward in the same epoch),
  then `publish-epochs.ts --epoch 1t-final --seq <new>`. I give both after a dry run.

### 2.4 Web

- A cargo switch in the header: `Presidente · Senado · Câmara · Assembleias` as plain links
  with `aria-current="page"` (`?cargo=senado|camara|assembleias`, default president).
  Native links, not a tab widget: each is a different view of the page, linkable, and
  the back button works. On the three legislative views the round selector is replaced by
  the fixed text "1º turno · resultado final" (the 2nd round elects neither).
- `hooks/use-legislative.ts`: `useLegislativeBr(office)`, `useLegislativeUf(office, uf)`,
  one `queryOptions` factory each in `data/queries.ts`, reading the `1t-final` manifest
  from `epochs.json` whatever `?turno` says.
- Components (new, thin):
  - `seat-bars.tsx`: the national composition as **labelled horizontal bars**, one row per
    party (sigla, seats, bar), sorted by seats, with `<table>` semantics under it (the
    same pattern as `uf-table`). PT and PL in their party colours, every other party
    neutral, the sigla always printed beside the bar.
  - `elected-list.tsx`: per UF (the existing `?uf`), the elected in vote order: name,
    party, votes, % and the TSE's `st` ("Eleito por QP"). Senate: every candidate, the two
    elected marked by text and weight as well as colour, with their alternates.
  - `uf-seats-table.tsx`: UF × seats per party for the selected chamber.
- Footer: the sums are ours, as the existing `calc` underline says ("soma das 27 UFs").

### 2.5 Samples

Into `docs/research/samples/` (with `.jws`): `ele2026_6259_dados_sp_sp-c0005-e006259-u`,
`…sp-c0006…`, `…df-c0008…` and `…ac-c0007…` (the smallest Assembleia, so the repo
doesn't carry SP's 353 KB twice). The parser tests run on them (CLAUDE.md, Tests).
`docs/research/01-tse-results-feed.md` §3–4 gets the table in §1.1.

### 2.6 Alternatives considered and rejected

- *A one-off fetch script that writes the archive straight into the web build:* rejected.
  It skips the raw log (invariant 2), so no number would trace to a stored signed file, and
  it would miss a later re-totalization.
- *Municipality files for these offices (a senate/deputies map):* rejected for now. 3
  offices × 5,570 municipalities ≈ 17 k requests and ~4.5 GB raw for deputies alone, for a
  map nobody needs on the 25th. The `uf` mode leaves the door open: dropping `:uf` from the
  senate target later fetches them.
- *Hemicycle chart:* rejected. 20 parties in the Câmara need 20 distinguishable colours,
  which can't all meet AA contrast, and the reference site's left/centre/right blocs are an
  editorial classification, not TSE data (research 04 §2). Labelled bars carry the same
  numbers with the party name on every row.
- *New routes (`/senado`):* rejected while on plan B (§1). Revisit with CloudFront.
- *Party vote totals (`tvtn`/`tvtl`):* deferred until their meaning is verified (§1.1).

## 3. Why

It finishes the 1st round's story with data the TSE already froze, on the infrastructure
that's built: four recorder targets, a new view family, one page section. It costs the TSE
0.135 req/s and costs us cents (~1 MB more per soak hour in the raw log, 84 small views).
It comes before the Phase 5 should-haves by the user's decision, and must not push Phase 2
(the projector on Fargate, Kafka on Redpanda): **time box 10-09 → 10-10**. If it runs
over, the web part ships with the Câmara only and the Senado and Assembleias follow.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `packages/tse/src/codes.ts` | edit | `OFFICES` 5–8 |
| `apps/recorder/src/config.ts`, `targets.ts` (+ tests) | edit | `:uf` aggregate-only targets, areas per office |
| `packages/contracts/src/tse/files.ts` (+ test) | edit | `qe`, `vag` |
| `packages/contracts/src/views/legislative.ts`, `views/index.ts` | new / edit | UF and br views |
| `packages/views/src/model.ts`, `render.ts`, `reconcile.ts`, `views.test.ts` | edit | classify, extract, render, sum checks |
| `apps/projector/src/config.ts` | edit | `legislative` from the state election code |
| `apps/web/src/app/page.tsx` | edit | cargo switch, legislative section |
| `apps/web/src/data/queries.ts`, `hooks/use-legislative.ts` | edit / new | queries + hooks |
| `apps/web/src/components/{cargo-nav,seat-bars,elected-list,uf-seats-table}.tsx` | new | |
| `apps/web/e2e/*` | edit | cargo switch, keyboard, axe |
| `docs/research/samples/` | new | 4 files + `.jws` |
| `docs/research/01-tse-results-feed.md` | edit | offices 5–8 (§1.1) |
| `docs/architecture.md`, `CLAUDE.md`, `README.md` | edit | archive scope, recorder targets, status |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green. New tests: the 4 samples parse and
   verify (`.jws`); `targets` gives 27/27/26/1 files for offices 5/6/7/8 and no
   municipal or coverage file for a `:uf` target; the views over the samples give SP
   senate 2 elected, SP federal 70 = Σ `vag` = count(`e`), DF distrital 24.
2. After the user's recorder deploy: within 10 min, `aws s3` shows 81 new paths under the
   `6259` offices 5–8 in the obs segments, each with a verified signature; the recorder's
   `tse_requests_total` rate rises by ≤ 0.2 req/s.
3. Rebuild against the real log (local first, `.replay/real/pub`): 114 + 84 = **198 views**,
   0 rejected, every president/governor view hash **unchanged** from the 10-08 seed, the
   per-UF sums all equal; `legislative/senate/br` = **54** seats with the §1.1 party split;
   `legislative/federal-deputy/br` = **513** with PL 121, PT 70; `state-deputy/br` = the
   sum of `nv` over the 27 files (checked against the files, not memory).
4. Published (user runs the seed + `publish-epochs`): Playwright e2e on the built site:
   `?cargo=camara` shows 513 and PL 121; `?cargo=senado&uf=sp` lists 13 candidates with
   2 marked "Eleito"; the cargo links are reachable by Tab and show `aria-current`; axe-core
   0 violations on all four views at 375 px and 1440 px; no horizontal page scroll at
   375 px.
5. Screenshot critique (light and dark, 375 and 1440) against the reference's
   `deputados.png`/`senado.png`, recorded in §6 of this document.
