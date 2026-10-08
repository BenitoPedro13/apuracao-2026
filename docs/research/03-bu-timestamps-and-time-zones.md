# 03 · Section-level timestamps (BU) and the time zone of TSE `dt/ht`

Verified 2026-10-08 against real files. This research enables a real timeline of the 1st
round (which our raw log can't give: the recorder started on 10-08 and holds only final
versions) and it found that the result feed's `dt/ht` are **local time**, which our code
reads as Brasília time.

## 1. The TSE publishes every BU (boletim de urna) with its receipt time

- **Where:** the TSE open-data portal (CKAN), dataset `resultados-2026-boletim-de-urna`
  ([API](https://dadosabertos.tse.jus.br/api/3/action/package_search?q=boletim%20de%20urna%202022)):
  one zip per UF and round on the TSE CDN, e.g.
  `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/buweb/bweb_1t_AC_051020261403.zip`,
  with a `.zip.sha512` sibling. **The 2026 1st round is already published** (files
  generated 05/10/2026 14:03). `resultados-2022-boletim-de-urna` has **both 2022 rounds**
  (`bweb_1t_AC_051020221321.zip`, `bweb_2t_AC_311020221535.zip`, …). 2024 (municipal)
  too.
- **Format** (the zip's own `_leiame-boletimurnaweb.pdf`): Latin-1 CSV, `;`-separated,
  every field quoted; `#NULO#` / −1 = blank, `#NE#` / −3 = not recorded that year. One row
  per (section, office, votable): `NR_ZONA`, `NR_SECAO`, `CD_MUNICIPIO`,
  `CD_CARGO_PERGUNTA` (1 = Presidente), `NR_VOTAVEL` (candidate number; 95 blank, 96
  null, 97 annulled and counted separately), `QT_VOTOS`, `QT_APTOS`, `QT_COMPARECIMENTO`,
  `QT_ABSTENCOES`, `DS_TIPO_URNA` (Apurada, Não apurada, Anulada e apurada em separado,
  Anulada, Não instalada), and four instants: `DT_ABERTURA`, `DT_ENCERRAMENTO`,
  `DT_EMISSAO_BU`, **`DT_BU_RECEBIDO`** ("data do boletim de urna recebido").
  The leiame states a time zone only for `HH_GERACAO` (Brasília).
- **Checked on AC 2026 1st round** (`bweb_1t_AC_051020261403.zip`, 16,959,055 B, SHA-512
  `c0951645…99ab1`, matches the published `.sha512`): 2,270 president sections, all
  "Apurada" = the TSE's `ac-c0001-e006257-u` `s.st` (2,270); blank votes 5,579 = the
  file's `vb`; every candidate's votes equal the file's `vap`, **except number 28, with
  23 votes in the BUs and absent from the result file** `[VERIFY: why; likely a candidacy
  whose votes were annulled]`.

## 2. `DT_BU_RECEBIDO` is Brasília time; the result feed's `dt/ht` are the municipality's local time

For each municipality, the last president BU received (`DT_BU_RECEBIDO`) against the
municipality's row `dt/ht` in its UF's `-ab` coverage file (our capture):

| UF | Legal time | last BU − row `ht`, median (min / max), minutes | Municipalities |
|---|---|---|---|
| AC | UTC−5 | **+116.8** (110.1 / 119.8) | 22 |
| AM | UTC−4 (west: UTC−5) | **+59.8** (57.5 / 120.0) | 62 |
| DF | UTC−3 | **−10.5** | 1 |

Only one reading fits all three: **BU receipts are stamped in Brasília time, and the
coverage rows' `dt/ht` in the municipality's local time**, a few minutes after its last BU
(AC 01040: last BU 18:15:46 Brasília, row 16:17:01 = 18:17:01 Brasília). It also explains
the "row before polls closed" seen in research 02 §9 (16:16:53: an Acre municipality).
AM's maximum of 120 min fits western Amazonas being on UTC−5.

Consequences (fixed by `TASK-time-zones.md`, see its §6 for the full rule, including the
Brasília-time central re-stamps and UF-level stamps):

- `tseInstant(dt, ht)` (`packages/contracts`) appends `-03:00` to every `dt/ht`. For
  municipalities in AC, AM, RO, RR, MT, MS (UTC−4/−5) and Fernando de Noronha (UTC−2),
  every instant we derive from a municipal or coverage row is off by 1–2 h. Abroad rows
  are presumably each city's local time `[VERIFY: zz rows against the ZZ bweb file]`.
- **The recorder's tier-2 check is not affected:** it compares a row's instant with the
  same municipality's file instant, both read the same (wrong) way.
- **Affected:** any instant we show or order by across municipalities or UFs (the views'
  `totalizedAt`, a timeline, fake-tse's reveal order: Acre's municipalities appear 2 h
  early in the replay). `[VERIFY: whether UF and br rows/files (e.g. br-ab's UF rows, the
  br -u file's dt/ht) are local to the UF or Brasília]`.
- The fix needs each municipality's UTC offset. The BU files give it empirically (round
  the median offset per municipality to whole hours); cross-check against the IANA tz
  database zones for Brazil (`America/Rio_Branco`, `America/Eirunepe`, `America/Manaus`,
  `America/Porto_Velho`, `America/Boa_Vista`, `America/Cuiaba`, `America/Campo_Grande`,
  `America/Noronha`, …) `[VERIFY: which municipalities each zone covers]`.

## 3. What this makes possible: a real 1st-round timeline

Summing the president votes of every BU received up to instant *t* gives, for any *t*, a
count made only of TSE-published section records, which ends at the official total (AC:
exact, §1). It's not the TSE's live screen at *t* (totalization lags receipt by minutes,
§2), so it must be labelled as "boletins recebidos até hh:mm", never as the TSE's number
at that time. The same works for the 2022 rounds, and for the 2026 2nd round once its BUs
are published (the 1st round's appeared the next day).

## 4. The TSE also publishes the official totalization history (found 2026-10-08)

- **`resultados-2022`** (CKAN) has **"Histórico totalização Presidente 1º Turno - 2022"**
  and **"2º Turno"**: `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/Historico_Totalizacao_Presidente_BR_1T_2022.zip`
  (1,625,754 B; CSV 13.8 MB + `leiame.pdf`). Latin-1, `;`-separated, padded fields;
  **one row per totalization instant**, to the second (`DT_TOTALIZACAO` from
  02/10/2022 17:04:47; 8,436 rows), with sections totalized (instant and cumulative, % of
  total), electorate, votes (total, valid), and per candidate votes and % (instant and
  cumulative), with one column group per candidate name (`LULA_QT_VOTOS_TOT_ACUMULADO`…).
  `[VERIFY: the leiame's definitions and time zone of DT_TOTALIZACAO (presumably
  Brasília); the 2nd round file]`
- It's **the TSE's own record of the night**, i.e. what its screen showed, not a sum of BU
  receipts: for 2022 the comparison curves come from here.
- **Publication lag in 2022:** 1st round (10-02) published 10-18, 2nd round (10-30)
  published 11-01. **For 2026, `resultados-2026` has only "Relatório de Totalização" (per
  UF, 10-06) so far.** If the 1st round's history follows 2022's lag, it appears around
  10-18/10-20, before the 2nd round `[VERIFY: daily from 10-12]`. The BU-receipt curve
  (§3) stands in until it does, and becomes a cross-check after.
- **Old elections don't disappear, they move:** the live feed's catalog (`comum/config/ele-c`)
  now lists only the 2024 and 2026 cycles, while `resultados-2022` keeps per-candidate
  results for every office ("Votação nominal por município e zona", with each candidate's
  situation, e.g. elected), per-section votes and the BUs, each with a published hash. So
  senators and deputies (2022, and 2026 once its files are published there) don't need our
  recorder.
