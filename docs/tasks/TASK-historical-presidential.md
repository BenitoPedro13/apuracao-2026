# TASK — Eight presidential elections: history, questions and "sua cidade"

> Written 2026-10-09, before any code. Research: `docs/research/05-historical-results.md`
> (files, quirks, verified totals, the findings this page is built around). Scope:
> **president only, 1994–2022** (user, 2026-10-09). An exploration page was published first
> as a throwaway (Artifact "Oito eleições presidenciais"); this task is the real version.

## 1. Current scenario

- The dashboard knows one year: 2026, from the recorder's raw log (`6257` president,
  `6259` states). Nothing in contracts, views or web has a notion of "another election".
- The TSE publishes every presidential election since 1994, per municipality and zone, as
  zipped CSVs on `cdn.tse.jus.br/estatistica/sead/odsele/` (research 05 §1). They are final
  results only: **no count-over-time exists for past years**, so the timeline scrubber has
  nothing to replay before 2026 (and must say so, never draw a curve).
- The exploration page showed that the data is good: national totals match the
  official ones, and 5,570/5,570 municipalities join the map. It also showed the
  **product problem the user named**: "PT share went from X to Y" answers a question
  nobody asked. It shows a change without saying what changed, to what, or why.
  People come with questions about **their town, the outcome, and the country**, not about
  one party's share.
- Site constraints that shape the design: static export served from the S3 REST endpoint
  (plan B, `TASK-public-cdn.md` §8.3), which has **no routes**. Everything is one page
  switched by query parameters (`?cargo=`, `?turno=`, `?uf=` exist today).

## 2. Planned changes

### 2.1 The product: questions first

Every panel is titled with the question a reader would ask, opens with a one-sentence answer
and its key number, and only then shows a chart. A **"Como calculamos"** disclosure under it
gives the method, and **a table** follows (invariant 7). Every number we compute is
marked as ours (the dotted-underline convention of `TASK-visual-identity.md`). The two-pole
framing ("PT" × "the PT's main rival": PSDB 1994–2014, PSL 2018, PL 2022) is used because
the data supports it (research 05 §6.3: the rival's map carries over at r = 0.85–0.98 since
2006). It's measured, not assumed, and the page says so.

Panels, in page order. Copy in Portuguese on the site; the numbers are the verified ones from
research 05 §6, and they become test expectations (§5).

| # | Question (site title) | The answer it opens with | Form | Data |
|---|---|---|---|---|
| P1 | **Como a sua cidade votou desde 1994?** | "Itaquaquecetuba votou no vencedor nas 8 eleições." / "Votou mais no PT que o Brasil em 6 de 8." | municipality search (combobox), then a 14-round strip (winner, margin, turnout vs Brazil), electorate growth, and **"cidades que votam como a sua"** (nearest neighbours on the 8-election vector, often in another state) | results |
| P2 | **Quem decidiu 2022?** (any year with a 2nd round) | "Lula venceu por 2.139.645 votos, menos que os 32,2 milhões que não foram votar." | diverging bars: net margin by UF; Nordeste vs rest; margin vs abstentions vs São Paulo city | results |
| P3 | **Existem cidades que sempre acertam?** | "113 de 5.019 municípios votaram no vencedor em todas as 8 eleições, e 66 deles são mineiros." | map of hits 0–8 (sequential); list; "espelho do Brasil" ranking | results |
| P4 | **O que aconteceu em 2006?** | "Lula ganhou duas vezes, com eleitores diferentes: a correlação entre o mapa de 2002 e o de 2006 é zero." | persistence line (r per pair), 2002 × 2006 scatter, the Guaribas story, flipped-municipality counts | results |
| P5 | **De onde veio o eleitor de Bolsonaro?** | "Do mapa de Aécio: a correlação entre Aécio 2014 e Bolsonaro 2018 é 0,87; com Marina, 0,11." | two scatters side by side; rival-map persistence line | results |
| P6 | **O Brasil está mais dividido?** | "Em 2022, só 22% dos eleitores viviam em cidades com vitória de 70/30, o menor índice da série. Em 2018 eram 38%." | line over years + margin map for the chosen year | results |
| P7 | **Para onde vão os votos de quem fica em 3º?** | "Entre os turnos de 2022, Bolsonaro ganhou 7,1 milhões de votos; Lula, 3,1." | paired bars per year (others' 1st-round votes, each finalist's gain); municipal association with the ecological-fallacy warning in the answer itself | results |
| P8 | **Quantos votos não contam?** | "A urna eletrônica derrubou brancos e nulos de 19% para 10%. A abstenção sobe desde 2006." | three lines (abstention, blank, null), urna annotation; 2022 = the only 2nd round with higher turnout | results |
| P9 | **Quanto pesa cada lugar?** | "São Paulo tem mais eleitores que 23 dos 27 estados, e tantos quanto os 2.225 menores municípios juntos." | bar of UFs with the city as a marker; a unit chart of municipalities | results |
| P10 | **E os brasileiros no exterior?** | "Eram 47 mil em 1998, 695 mil em 2022, e mudam de lado mais que o Brasil." | line + table | results |

Plus the **year view**: `?ano=2006` (any of the 8 years, plus `?turno=`) shows the existing
election-night panels (headline, map, regions, turnout, municipality table) fed with that
year's final result. That's the user's "use this dashboard for any election year". The
timeline panel says "Contagem ao longo da noite não registrada para 2006". It doesn't
draw a curve and isn't hidden without a word.

**Later phases, not in this task** (each needs its own research first, listed in research
05 §7):
- **Phase B, "Quem é o eleitor":** TSE voter profile 1994–2026 by municipality (age, sex,
  schooling): ageing, the women's majority, schooling. TSE data, same trust level.
- **Phase C, "Por quê?":** IBGE Censo 2010/2022 per municipality (religion, income)
  against the vote, with "associação, não causa" and the ecological fallacy stated up front.
- Other offices from the same zips (governor, senate, deputies).

### 2.2 Data pipeline (static: no projector, no broker)

```
cdn.tse.jus.br/…/odsele  ──(capture, user-run)──▶  S3 raw  hist/odsele/<type>/<sha256>.zip   (kept forever, invariant 2)
                                                  └▶ local cache .cache/tse-hist/ (gitignored + dockerignored)
.cache zips ──(scripts/build-history.ts: stream unzip → packages/tse/odsele parse → packages/views/history fold)──▶
apps/web/public/history/<name>.<hash>.json  (committed, content-addressed, like the map geometry)
```

1. **`scripts/capture-history.ts`**: for each of the 16 zips (and `.sha512` if the TSE adds
   one `[VERIFY: no .sha512 sibling for odsele zips; the bweb zips have one]`): a sequential
   GET (no parallelism: one host, politeness), `If-None-Match`/`If-Modified-Since` against
   the last capture, SHA-256, and a write-once put to `hist/odsele/<type>/<sha256>.zip` with a
   sidecar JSON (URL, `Last-Modified`, `ETag`, size, fetched-at, **content identity** =
   SHA-256 of the CSV rows minus `DT_GERACAO`/`HH_GERACAO`, research 05 §2). Uses
   `packages/s3kit` write-once put. **The user runs the bucket writes**
   (`--dry-run` first), as for every bucket write.
2. **`packages/tse/src/odsele/`** (pure, browser-free): header-keyed row parsing, Latin-1,
   `#NULO#`/`#NE#`/−1/−3 to explicit `null`/`notRecorded`, and the research 05 §3 rules as
   named functions (`votesOf(row)`, `nullVotesOf(row)`, `municipalityCode(raw)` = 5-digit
   pad, `kindOf(uf)` = domestic | abroad | transit). Zip streaming stays in the script, not
   in the package.
3. **`packages/contracts/src/views/history.ts`**: Zod schemas:
   - `HistoryIndex`: years, rounds, file names + hashes, source zips' SHA-256 and content ids.
   - `HistoryYear` (one file per year, ~150–250 KB raw `[VERIFY: measure]`): national totals,
     per-UF, per-municipality per round (candidates with votes, aptos, comparecimento,
     brancos, nulos, kind). **Missing ≠ zero**: a municipality absent in a year is absent,
     never 0.
   - `HistoryMunicipalities` (~600 KB `[VERIFY]`, loaded on the first search): the
     14-round history per IBGE code, for P1.
   - `HistoryInsights`: precomputed answers for P2–P10 (small; the page's first load).
   - **Year view reuse:** the fold also emits the *existing* president view contracts for
     each year, so the year view needs no new components `[VERIFY: which fields of the
     current views are 2026-feed-specific (seq, idg, dt/ht, signatures) and how to mark
     them "not applicable" without weakening the live contracts]`.
4. **`packages/views/src/history/`**: pure folds, `fold(rows) → HistoryYear`, and the
   insight functions, each one small and named after its question: `bellwethers`,
   `persistence`, `rivalPersistence`, `landslideShare`, `marginBreakdown`,
   `roundTransfers`, `invalidVotes`, `electorateWeight`, `abroad`, `similarMunicipalities`.
5. **`scripts/build-history.ts`** runs 2→4 over the cache and writes the content-addressed
   files plus `history/index.json`. It's deterministic: same zips, same bytes out.

### 2.3 Web

- **Mode switch:** `?historico` opens the questions page; `?ano=YYYY` opens the year view.
  The header gets a year selector (2026 live + the 8 archive years). All of these are query
  parameters (no routes, §1).
- **Data hooks:** one `queryOptions` factory per file (`historyIndexOptions`,
  `historyYearOptions(year)`, `historyMunicipalitiesOptions`, `historyInsightsOptions`),
  `staleTime: Infinity` (immutable, content-addressed). Each wrapped in a named hook
  (`useHistoryYear`, `useMunicipalityHistory(code)`), per the global frontend rules.
- **Components** (`components/history/`): `QuestionPanel` (title, answer, chart slot, "Como
  calculamos", table), `MunicipalitySearch` (shadcn Combobox: accessible, keyboard; diacritic-
  insensitive search), `RoundStrip`, `ScatterCanvas` (5,570 points: Canvas 2D with an
  accessible table, like the map), `LineChart`/`DivergingBars` (hand-written SVG, matching
  `seat-bars.tsx`/`hemicycle.tsx`; no chart library, YAGNI). The map gets new colour
  functions (swing: diverging `--map-pl-*`/`--map-pt-*` around `--map-other-1`; hits:
  one-hue sequential; "not a municipality yet": hatched, with its own legend entry).
- **Server/client split:** the question copy and the tables of `HistoryInsights` render at
  build time (static export). Only the search, the map and the hover are client components.

### 2.4 Alternatives considered and rejected

- **Feed history through the projector as epochs:** the projector folds an observation log
  of a live feed; these are 16 static files. It would touch the critical path in the
  2nd-round week for no gain. Rejected.
- **Publish history views to `apuracao26-pub`:** possible later. Shipping them with the site
  (like the 306 KB map geometry) costs nothing and keeps the history readable even if the
  bucket pointer is broken. Revisit if the files pass ~5 MB.
- **Party-share small multiples as the main view** (the exploration page's lead): rejected
  for the user's reason above. They stay as an option inside P4.
- **Estimating individual vote transfers (ecological inference models):** produces numbers
  that look like counts but are model outputs. That's against the spirit of invariant 1.
  P7 shows real sums and a labelled association only.
- **`/historico` as a route:** impossible on plan B (no index documents).
- **A chart library (Recharts, visx):** five simple forms, all on fixed scales. The repo
  draws its charts by hand. Rejected until a form needs one.

## 3. Why

- It answers the user's ask: any election year on the same dashboard, and the
  cross-election questions people actually have (their town, who decided, whether the
  country is splitting, where votes go).
- It reuses the map, the visual identity and the contracts discipline. History becomes
  one more data source.
- **Cost:** about 2 GB in S3 raw (~US$0.05/month), nothing billed by the hour, ~2 MB more in the
  site. **Risk to the 25th:** the pipeline, contracts and views are additive. The risk is
  `apps/web` (header selector, mode switch). Hence §6 scheduling.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `docs/research/05-historical-results.md` | new (done) | sources, quirks, totals, findings |
| `docs/research/samples/hist/*` | new (done) | real excerpts with each quirk, 4 `leiame.pdf`, zip SHA-256 |
| `scripts/capture-history.ts` | new | sequential capture → S3 raw `hist/` + cache; `--dry-run` |
| `scripts/build-history.ts` | new | cache → content-addressed JSON in `apps/web/public/history/` |
| `packages/tse/src/odsele/{parse,rules}.ts` + tests | new | tested on `samples/hist` only |
| `packages/contracts/src/views/history.ts` + tests | new | Zod schemas |
| `packages/views/src/history/*.ts` + tests | new | folds + one function per question |
| `apps/web/src/hooks/history.ts` | new | query option factories + named hooks |
| `apps/web/src/components/history/*` | new | panels, search, charts |
| `apps/web/src/app/page.tsx`, header | edit | `?historico`, `?ano=` |
| `apps/web/src/components/map/*` | edit | colour functions for swing / hits / not-yet |
| `apps/web/public/history/*` | new (generated) | committed like `geo/` |
| `.gitignore`, `.dockerignore` | edit | `.cache/` (2 GB of zips; research: CDK asset hashing) |
| `package.json` / workspace | edit | zip streaming dependency `[VERIFY: fflate vs yauzl, maintained, pnpm minimumReleaseAge]` |
| `CLAUDE.md`, `README.md`, `docs/architecture.md` | edit | status, the history data path, research 05 in the reading list |

## 5. Verification

1. **Parsers on real samples** (`pnpm turbo run test --filter=@apuracao/tse`):
   - 1998 president rows: votes from `QT_VOTOS_NOMINAIS_VALIDOS` (Acrelândia, Ciro: 173), never 0.
   - 1994 detail: Ji-Paraná null = 2,991, valid = 33,833, blank = 3,573; their sum = turnout 40,397.
   - Oiapoque: `6092` (2018/2022 candidates) and `06092` (detail) give the same key.
   - 2010 `VT` rows are `transit`; `ZZ` rows are `abroad`; `91065` (2002) joins nothing
     and is reported, not dropped silently.
2. **Build reproduces research 05**, two independent implementations (the scratch Python
   of 2026-10-09 and the TS build): `pnpm exec node scripts/build-history.ts --check` fails
   unless:
   - all 14 national rows of research 05 §5 match to the vote;
   - joins: the research 05 §4 table exactly;
   - insights: 113 bellwethers (66 MG); r 2002→2006 = −0.013 ± 0.001; Aécio 2014 →
     Bolsonaro 2018 r = 0.874; landslide shares 34.2 / 23.0 / 26.0 / 38.3 / 22.0%;
     2022 margin 2,139,645, abstentions 32,200,558; SP city 9,320,706 > 23 UFs; abroad
     47,469 → 695,355.
3. **Deterministic and idempotent:** run the build twice, `shasum` of `public/history/*`
   identical. A capture of an unchanged TSE file is a no-op in S3 (write-once put
   returns "exists").
4. **Replay:** delete `public/history/`, rebuild from the S3 raw copies (not the CDN),
   same bytes.
5. **Missing ≠ zero:** in the 1994 year view, a municipality created in 1997 shows "não
   existia em 1994" on hover and in the table, hatched on the map, and appears in no sum.
6. **Web:** `pnpm turbo run lint check-types test build`; e2e (Playwright): `?historico`
   renders P1–P10 with no network beyond the site; search "itaqua" finds Itaquaquecetuba
   and shows "8 de 8"; `?ano=2006&turno=2` headline reads Lula 60,83% × Alckmin 39,17%;
   axe: 0 violations, light and dark; at 412 px no horizontal scroll; every chart has its table.
7. **Size:** first load of `?historico` ≤ 150 KB of history JSON gzip (insights + index);
   the municipality file loads only on the first search.

## 6. Scheduling (decide with the user)

The 2nd round is 2026-10-25. Recommendation: **land the additive parts now** (packages,
scripts, capture; nothing on the live path) and **merge the `apps/web` mode switch after
the 10-22 rehearsal or after 10-26**, so the night's page is not changed in its last week.
