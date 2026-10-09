# 05 · Historical presidential results, 1994–2022 (TSE open data)

Verified 2026-10-09 against the real files, downloaded and parsed end to end. This research
backs `docs/tasks/TASK-historical-presidential.md`: the dashboard reading **any**
presidential election since 1994, plus the cross-election questions in §6.

Scope: **president only** (user decision, 2026-10-09). The same zips also hold governor,
senate and deputies (§7).

## 1. Where the files are

- **Portal:** the TSE open-data CKAN, one dataset per year, `resultados-<year>`
  ([API](https://dadosabertos.tse.jus.br/api/3/action/package_show?id=resultados-2022)).
  The resources point to the TSE CDN, one zip per year and file type:
  `https://cdn.tse.jus.br/estatistica/sead/odsele/<type>/<type>_<year>.zip`. This is not
  the results feed the recorder polls (`/oficial/ele2026/…`), so these downloads take
  nothing from the live request budget.
- **The two files we need**, for every year 1994, 1998, …, 2022:

| Type | What one row is | Size of the zip (1994 → 2022) |
|---|---|---|
| `votacao_candidato_munzona` | votes of one candidate in one (round, municipality, zone, office) | 42.3 MB → 580.9 MB |
| `detalhe_votacao_munzona` | registered voters, turnout, blank, null, sections of one (round, municipality, zone, office) | 1.6 MB → 4.4 MB |

  Also published and not used yet: `votacao_partido_munzona` (party/legenda votes, 1994+),
  `votacao_secao` (per section, one zip per UF, 1998+), `detalhe_votacao_secao` (1998+).
- **Inside each zip:** one CSV per UF (`_AC.csv` … `_TO.csv`), a `_BRASIL.csv` with every
  office for the whole country, a `_BR.csv` with the **national-scope office only**
  (president), and `leiame.pdf` (the field dictionary). **1998's candidate zip has no
  `_BR.csv`**: read `_BRASIL.csv` and keep `CD_CARGO = 1` (66,185 rows).
- **Format:** Latin-1, `;`-separated, header row, most fields quoted. `#NULO#` / `-1` =
  empty, `#NE#` / `-3` = "not recorded that year". **The column order changes between
  years** (e.g. `CD_SIT_TOT_TURNO` moves; `NR_FEDERACAO` appears in 1994/1998 and 2018+, as
  `#NE`). Parse by header name, never by position.

SHA-256 of the 16 zips as downloaded on 2026-10-09 ~05:15 BRT: `samples/hist/SHA256SUMS-zips.txt`.

## 2. The TSE regenerates these files

Every row carries `DT_GERACAO`/`HH_GERACAO`. The 2022 candidate file downloaded at 05:19 BRT
on 2026-10-09 says `09/10/2026 03:16:47`; the 2022 detail file says `08/10/2026 03:17:17`;
the 1994 detail file `12/02/2026`. `Last-Modified` agrees (2022 candidates:
`Fri, 09 Oct 2026 07:18:46 GMT`). So **the 2022 files are rebuilt nightly**, around 03:17
Brasília, at least during this election period, and older years from time to time (a
second capture at ~06:00 BRT the same day got the same 16 sha256: no rebuild in between)
`[VERIFY: download 2022 again on 10-10 and diff; does anything but DT/HH_GERACAO change?]`.

**Seen happening (2026-10-09 ~09:30 BRT):** the 2022 detail zip went from `e9545d5a…`
(generated 08/10 03:17:17) to `8fd10a41…` (09/10 03:17:58). Same 12,567 rows, but **in a
different order**: 0 differences sorted, 25,131 in order. So a regeneration changes the stamp
*and the row order*.

Consequence for invariant 2: a byte-identity (SHA-256 of the zip) changes with no change in
the data. Store every distinct zip we download byte-for-byte, as the recorder does. Also give
each one a **content identity that ignores both the stamp and the order**: `RowSetHash`
(`packages/tse/src/odsele.ts`), the sum mod 2^256 of each row's sha256 with the two generation
columns removed. Both 2022 zips above get `77551f93…`. That's how the build tells "new day,
same data" from "the TSE corrected a count".

## 3. Quirks found while parsing (each one would have produced a wrong number)

| Year | Quirk | Rule | Sample |
|---|---|---|---|
| 1998 | `QT_VOTOS_NOMINAIS` is **0** on every president row; the votes are in `QT_VOTOS_NOMINAIS_VALIDOS` | votes = `QT_VOTOS_NOMINAIS_VALIDOS` when the column exists and is ≥ 0, else `QT_VOTOS_NOMINAIS` | `votacao_candidato_munzona_1998_BRASIL.presidente.head.csv` |
| 1994 | `QT_TOTAL_VOTOS_NULOS` and `QT_TOTAL_VOTOS_VALIDOS` are 0; null votes are in `QT_VOTOS_NULOS`, valid in `QT_VOTOS_NOMINAIS_VALIDOS`; `NR_ZONA` is −3 (no zones) | null = max(`QT_TOTAL_VOTOS_NULOS`, `QT_VOTOS_NULOS`); key 1994 by municipality only | `detalhe_votacao_munzona_1994_BR.head.csv` |
| 2018, 2022 | `CD_MUNICIPIO` is an **unquoted integer**, so leading zeros are lost (`6092` = Oiapoque, `06092` in the detail file and in the 2026 config) | left-pad to 5 digits before any join | `votacao_candidato_munzona_2018_BR.short-code.csv`, `…_2022_BR.06092.csv`, `detalhe_…_2018_BR.06092.csv` |
| 2010 | 27 pseudo-municipalities `99901`–`99927`, UF `VT`, one per capital: **transit votes** (voto em trânsito) | count them in national totals; never draw or rank them as municipalities | `detalhe_votacao_munzona_2010_BR.VT.csv` |
| 1998+ | `ZZ` = abroad: one "municipality" per city abroad (1994 has none) | in national totals; a separate "abroad" view; not on the map | — |
| 2002 | `91065` BOA ESPERANÇA DO NORTE (MT) votes as a municipality; absent from 2026's TSE config; the IBGE 2025 mesh has `5101837` Boa Esperança do Norte | shown as "not a municipality in this election" for every other year `[VERIFY: TSE history of 91065 vs IBGE 5101837 (created 2000, annulled, re-installed 2025?)]` | `votacao_candidato_munzona_2002_BR.91065.csv` |

| 2006 | `QT_TOTAL_VOTOS_NULOS` is **−2** on 32 rows abroad; `QT_VOTOS_NULOS` holds the count (Tailândia, 2nd round: 14 valid + 0 blank + 1 null = turnout 15) | a negative total is "not given": null = max(total, `QT_VOTOS_NULOS`) | `detalhe_votacao_munzona_2006_BR.negative-nulos.csv` |
| 2022 (any year) | `QT_APTOS` = `QT_COMPARECIMENTO` + `QT_ABSTENCOES` + **`QT_ELEITORES_SECOES_NAO_INSTALADAS`** (Conakry: 2 voters, a section never installed, 0 turnout, 0 abstentions) | carry the uninstalled-section voters as their own count | `detalhe_votacao_munzona_2022_BR.head.csv` |
| all | **38 exact ties** for first place over all rounds, in municipalities, cities abroad and one 2010 transit capital (e.g. TSE `64556`, 2022 2nd round, 5,529 × 5,529; `37230`, 1994, 3,960 × 3,960) | a tie has no winner: never a "hit", drawn as its own state | — |

## 4. Joining to the map

TSE municipality codes are stable across years. The TSE's own 2026 municipality config
(`samples/ele2026_6257_config_mun-e006257-cm.json`, `cd` → `cdi`) maps them to IBGE:

| Year | Domestic municipalities (excl. `ZZ`, `VT`) | Joined to IBGE |
|---|---|---|
| 1994 | 5,019 | 5,019 |
| 1998 | 5,513 | 5,513 |
| 2002 | 5,565 | 5,564 (`91065`, §3) |
| 2006 | 5,565 | 5,565 |
| 2010 | 5,567 | 5,567 |
| 2014, 2018, 2022 | 5,570 | 5,570 |

The 2025 mesh has 5,571 (+ `5101837`). A municipality created after an election has no row
for it. It is **not a municipality yet**, a fourth state beside counted, zero and failed
(invariant 6). It is never zero, and never its parent's number. `[VERIFY: 1994's 5,019
against the ~4,974 municipalities usually cited for 1994: are some 1993 creations voting
separately?]`

## 5. National totals (our sums of the per-zone files, abroad and transit included)

These match the officially announced results wherever I know them (2022 2nd round
60,345,999 × 58,206,354; 2002 2nd round 52,793,364 × 33,370,739).

| Year | Round | Winner | Votes | % valid | Runner-up | Votes | % valid | Registered | Turnout |
|---|---|---|---|---|---|---|---|---|---|
| 1994 | 1 | FHC (PSDB) | 34,350,217 | 54.28 | Lula (PT) | 17,112,255 | 27.04 | 94,710,636 | 82.3 |
| 1998 | 1 | FHC (PSDB) | 35,936,382 | 53.06 | Lula (PT) | 21,475,211 | 31.71 | 106,100,575 | 78.5 |
| 2002 | 2 | Lula (PT) | 52,793,364 | 61.27 | Serra (PSDB) | 33,370,739 | 38.73 | 115,253,816 | 79.5 |
| 2006 | 2 | Lula (PT) | 58,295,042 | 60.83 | Alckmin (PSDB) | 37,543,178 | 39.17 | 125,913,235 | 81.0 |
| 2010 | 2 | Dilma (PT) | 55,752,529 | 56.05 | Serra (PSDB) | 43,711,388 | 43.95 | 135,804,433 | 78.5 |
| 2014 | 2 | Dilma (PT) | 54,501,118 | 51.64 | Aécio (PSDB) | 51,041,155 | 48.36 | 142,822,046 | 78.9 |
| 2018 | 2 | Bolsonaro (PSL) | 57,797,847 | 55.13 | Haddad (PT) | 47,040,906 | 44.87 | 147,306,294 | 78.7 |
| 2022 | 2 | Lula (PT) | 60,345,999 | 50.90 | Bolsonaro (PL) | 58,206,354 | 49.10 | 156,454,011 | 79.4 |

`[VERIFY: 1994 FHC 34,350,217 against the TSE's published 1994 result (34,364,961 is the
figure usually quoted): is the gap of 14,744 abroad or annulled votes, missing from the munzona file?]`
2018: 147,306,295 registered in the 1st round, 147,306,294 in the 2nd `[VERIFY: one voter]`.

## 6. What the data says (computed 2026-10-09; these are ours, not the TSE's)

Each finding below is a candidate panel. Exact method: the scratch scripts summarised in
the task doc §2.3. Shares are over valid votes.

1. **Bellwethers ("does my town pick the president?").** Of the 5,019 municipalities that
   voted in all 8 elections, **112** voted for the national winner in the decisive round
   every time. **66 of them are in Minas Gerais.** (First written as 113: the scratch script
   counted an exact tie as a win; there are 38 exact ties in the archive, e.g. TSE `64556`
   in the 2022 2nd round, 5,529 × 5,529.) Largest: Itaquaquecetuba (SP, 251k
   voters), Ribeirão das Neves (MG), Itapevi (SP), Ferraz de Vasconcelos (SP), Teófilo
   Otoni (MG). The "mirror of Brazil" (smallest mean gap between its winner share and the
   national one): Guarani d'Oeste (SP), 2.3 p.p.; among cities over 200k voters,
   Itaquaquecetuba (4.0) and Carapicuíba (4.1).
2. **The 2002 → 2006 break.** Correlation of municipal PT share between consecutive
   elections: 0.74, 0.63, **−0.01 (2002→2006)**, 0.84, 0.89, 0.89, 0.92. Guaribas (PI):
   18.7% (2002) → 89.1% (2006); it was 12% in 1994 and 1998. Of the municipalities that
   voted in both 2002 and 2022, 1,373 went from more than 5 p.p. below the national PT share
   to more than 5 above; 389 went the other way. (First written as 1,191/358, counted only
   over the 5,019 that voted in all 8 elections; the page uses both-years, 2026-10-09.)
3. **The anti-PT map is older than Bolsonaro.** Correlation of the main rival's share:
   Aécio 2014 → Bolsonaro 2018 = **0.87** in the 1st round, **0.93** in the 2nd; Marina 2014 →
   Bolsonaro 2018 = 0.11. The rival map was redrawn once, in 2006 (Serra 2002 → Alckmin 2006 =
   0.33). Since then it holds (0.85–0.98), whatever the party: PSDB, PSL, PL.
4. **Brazil is not sorting itself geographically.** Share of voters living in a
   municipality won 70/30 or wider in the decisive round: 2006 34.2%, 2010 23.0%, 2014
   26.0%, **2018 38.3%**, **2022 22.0%**, the lowest of the series. The most polarised
   election by rhetoric was the least lopsided town by town.
5. **Decided by less than the people who stayed home.** 2022 margin: 2,139,645 votes
   (1.80%). Abstentions in that round: 32,200,558 (15×); blank + null: 5,700,443. The
   Nordeste gave Lula a net +12.57 M; the rest of Brazil plus abroad gave Bolsonaro
   −10.43 M net. SP state alone: −2.70 M; Bahia alone: +3.74 M. Abroad: +7,641.
6. **Where do the third candidates' voters go?** Gains between rounds, 2022: Bolsonaro
   +7.13 M, Lula +3.09 M (others had 9.90 M in the 1st round). 2018: Haddad +15.70 M,
   Bolsonaro +8.52 M. Across municipalities (2022), each point of Tebet + Ciro share goes with
   +0.85 p.p. for Bolsonaro and +0.25 for Lula between rounds. That is an association
   across towns, not individual vote transfers (the ecological fallacy). The page must say so.
7. **The urna eletrônica effect.** Blank + null in the 1st round: 18.8% of turnout (1994,
   paper), 18.7% (1998, partial e-voting), 10.4% (2002, all electronic since 2000), then
   8.4% (2006), 8.6%, 9.6%, 8.7% and 4.4% (2022) `[VERIFY: e-voting rollout years, TSE source]`. Abstention keeps rising: 16.8% (2006) →
   20.9% (2022). **2022 is the only 2nd round with more voters than its 1st (+570,424).**
8. **One city outweighs states.** São Paulo city: 9,320,706 voters (2022), more than 23 of
   the 27 UFs, more than the 7 smallest UFs combined (7.50 M), and as many as the 2,225
   smallest municipalities together. Smallest: Borá (SP), 1,039 voters.
9. **Abroad grew 15×:** 47,469 (1998) → 695,355 (2022), turnout 40–56%, and it swings
   hardest: PT 10.1% (2018) → 47.2% (2022).
10. **Home-state candidates bend the map:** Pires Ferreira (CE) PT 83% (2014) → 20% (2018) →
    75% (2022). 2018 is Ciro Gomes's state. `[VERIFY: Ciro's share there in 2018]`.

## 7. Context data for "why" (sources exist; nothing downloaded yet)

- **TSE voter profile**, `eleitorado-<year>` datasets, `perfil_eleitorado_<year>.zip` for every
  even year 1994–2026 (CKAN search, 2026-10-09): voters by municipality × sex × age band ×
  schooling (marital status in some years) `[VERIFY: fields per year, municipality level in 1994]`.
  TSE data, so the same trust level as the results. It answers "who are the voters", e.g. ageing,
  the women's majority, schooling.
- **IBGE Censo 2022:** aggregate tables crossing religion with other variables exist on the
  IBGE aggregates API (`servicodados.ibge.gov.br/api/v3/agregados`, e.g. 10198, 10199). Income tables
  exist too (10293) `[VERIFY: a religion × municipality table and a per-capita-income ×
  municipality table, their ids and the SIDRA query]`. Census 2010 for the 2010–2014 elections.
- These are **not TSE vote counts**, so invariant 1 doesn't forbid them. But any panel that
  uses them names the IBGE source and the census year, and says "association, not cause".
- Same zips, other offices: governor (`CD_CARGO` 3), senate (5), deputies (6, 7, 8) are in
  `_BRASIL.csv`. Out of scope for now.
