# Research 01 — The TSE results feed (verified 2026-10-07)

Everything marked **verified** was observed directly with `curl` against
`resultados.tse.jus.br` on 2026-10-07, two days after the 1st round closed. Real captured
files are in `docs/research/samples/`. Anything not verified is tagged `[VERIFY: …]`.

## 1. Key dates

| Event | Date | Status |
|---|---|---|
| 1st round | 2026-10-04 (Sun) | done: counted 100%, files frozen at final state |
| 2nd round | **2026-10-25 (Sun)** | president (Lula × Flávio Bolsonaro) + governor in **AC, AM, DF, ES, RJ, RN, TO** |
| Polls close | 17h Brasília time, nationwide | `[VERIFY: unified closing time still applies in 2026]` |

Sources: [Agência Brasil](https://agenciabrasil.ebc.com.br/politica/noticia/2026-10/Seis-estados-e-o-DF-terao-segundo-turno-para-governador), [Gazeta do Povo](https://www.gazetadopovo.com.br/eleicoes/2026/7-estados-terao-segundo-turno-para-governador-nas-eleicoes-de-2026-saiba-quais/).

## 2. Hosting (verified, from response headers)

- **Akamai CDN in front of an S3-compatible origin** (`akamai-grn`, `x-amz-request-id`, `cdn-cache-status`).
- `cache-control: max-age≈60`, plus `expires`. **Polling more often than every ~30–60 s gains
  nothing**, because the edge serves the cached copy.
- **`ETag` + `If-None-Match` → `304 Not Modified` works.** Conditional GETs make "nothing
  changed" responses almost free.
- `x-ratelimit-limit: 2000, 2000;w=1` (2,000 requests per 1-second window). **Update
  2026-10-07:** the `remaining` counter does not move with our requests, so this is the
  origin's limit towards Akamai, not a per-client budget. The real client limit is unknown
  (see `02-signatures-cache-and-map-mesh.md` §3).
- `content-encoding: gzip` is supported. The national file is 9.3 KB raw, 2.4 KB gzipped.
- The public TSE information pages on `www.tse.jus.br` return **403 to non-browser
  fetchers**. The data host does not.

## 3. Discovery: the config files

| File | URL | What it gives you |
|---|---|---|
| Election catalog | `/oficial/comum/config/ele-c.json` | every *pleito*/election, its codes, offices, and **URL templates** in `arq[]` |
| Municipality index | `/oficial/ele2026/{ele}/config/mun-e{ele:06}-cm.json` | 28 "UFs" (27 + `zz` = abroad), **5,757 municipalities**, each with TSE code `cd`, **IBGE code `cdi`**, name, zones |

URL templates from `ele-c.json` (verbatim):

```
ft   <base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>                 candidate photos
cm   <base>/<ambiente>/<ciclo>/<cd_eleicao>/config
e|ab|u <base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>
cs   <base>/<ambiente>/<ciclo>/arquivo-urna/<cd_pleito>/config/<uf>
aux  <base>/<ambiente>/<ciclo>/arquivo-urna/<cd_pleito>/dados/<uf>/<municipio>/<zona>/<secao>   per-section ballot-box files
```

2026 codes (pleito `3220`, 04/10/2026):

| Election | 1st round | 2nd round (`cdt2`) | Offices |
|---|---|---|---|
| Federal | `6257` | **`6258`** | Presidente (`c0001`) |
| State | `6259` | **`6260`** | Governador (`c0003`), Senador, Dep. Federal, Dep. Estadual, Dep. Distrital |

**2nd-round files (`6258`/`6260`) currently 404** (re-checked 2026-10-07 13:00 UTC). They will appear closer to the day.
`[VERIFY: re-check daily from 2026-10-20; confirm the same naming carries over]`

## 4. Data files (verified)

Naming: `{uf}{cdmun?}-c{cargo:04}-e{ele:06}-u.json` for results, `{uf}-e{ele:06}-ab.json` for coverage.

| File | Example | Size | Content |
|---|---|---|---|
| National results | `dados/br/br-c0001-e006257-u.json` | 9.3 KB | totals + every candidate (`vap` votes, `pvap` %, `st` status, `e` elected) |
| State results | `dados/sp/sp-c0001-e006257-u.json` | 9.4 KB | same shape, one state |
| Municipality results | `dados/sp/sp71072-c0001-e006257-u.json` | 9.4 KB | same shape, one municipality (`71072` = São Paulo) |
| Abroad | `dados/zz/zz-c0001-e006257-u.json` | 9.3 KB | votes cast abroad |
| Governor (state elec.) | `ele2026/6259/dados/rj/rj-c0003-e006259-u.json` | 7.7 KB | same shape |
| **National coverage** | `dados/br/br-e006257-ab.json` | 29 KB | one row **per UF**: sections counted, turnout, municipalities finished/partial/not started (`munf`, `munpt`, `munnr`), `dt`/`ht` |
| **State coverage** | `dados/sp/sp-e006257-ab.json` | 537 KB | one row **per municipality**: sections counted/total, electorate, turnout, **`dt`/`ht` = last totalization time** — **no candidate votes** |

Shape notes (from `br-c0001-e006257-u.json`):

- **Every file is a full snapshot, not a delta.** The header has `dg`/`hg` (generation
  date/time), `idg` (generation id, monotonically increasing), `dt`/`ht` (totalization time),
  `tf` (finalized), `and` (count status).
- **All numbers are strings**, with Brazilian decimals: `"pvap": "47,03"`, plus a higher-precision
  `"pvapn": "47,027772356"`. Parsing is a contract concern.
- Candidates are nested `carg[] → agr[] (coalition) → par[] (party) → cand[]`, with
  federations in `fed[]`.
- `s` = sections (`st` counted, `ts` total, `pst` %), `e` = electorate/turnout (`c`
  turnout, `a` abstention), `v` = votes (valid `vv`, blank `vb`, null `vn`, …).
- The cross-check matches the dashboard screenshot: Flávio 56,104,503 (47.03%), Lula 53,879,538 (45.16%),
  valid votes 119,300,788, turnout 78.92%.

## 5. What this implies for the design (findings, not decisions)

1. **Change detection is cheap and two-tier.** 28 coverage files (`br` + 27 UFs) tell you
   *which municipalities' `ht` changed*. You only then fetch those municipalities' `-u`
   files. A full sweep is ~29 coverage files, plus 1 national, 28 UF and N changed
   municipality result files per office, all conditional.
2. **Volume is tiny, change rate is the challenge.** 2nd round ≈ 5,757 municipalities ×
   (president) + the municipalities of 7 states × (governor), at ~9 KB each. A full snapshot of
   the whole country is ~60 MB raw. The difficulty is *keeping history of every version*
   and *serving many concurrent readers*, not the raw size.
3. **The TSE does not keep history.** The URL always serves the *latest* version, so the
   minute-by-minute timeline ("Ao longo da apuração", the scrubber) **only exists if we
   record it ourselves while the count is live**. For the 1st round that history is gone,
   except approximate per-municipality "finished at" times (`ht` in `-ab`) and whatever
   third parties archived `[VERIFY: Internet Archive / other public captures of 2026-10-04]`.
4. **The IBGE code (`cdi`) is in the municipality index**, so joining with IBGE municipal
   boundary meshes for the map is a straight key join. **Verified 2026-10-07:** Malha Municipal 2025 joins 5,571/5,571; the
   simplified TopoJSON is ~330 KB gzipped (`02-signatures-cache-and-map-mesh.md` §6).
5. **Signatures.** The official app loads `assets/assinatura-jws/{key}.jwk.json`, which
   suggests result files are JWS-signed and verifiable. **Verified 2026-10-07:** every `.json`
   has a `.jws` sibling (EdDSA/Ed25519, compact, embedded payload byte-identical to the
   `.json`), and the signatures verify (`02-signatures-cache-and-map-mesh.md` §2).
6. **Test environment.** The TSE documents a simulated environment
   `https://resultados-sim.tse.jus.br/simulado` (`simulado2026`, pleito `17801`), but its
   **DNS did not resolve on 2026-10-07**, and the homologation host `resultados-hmg` resolves
   to `127.0.0.1` `[VERIFY: re-check weekly whether it comes up before the 2nd round]`.
   Until then, a harness that **replays real captured 1st-round files** is the test bed.
7. **After the count:** per-section ballot-box data (`arquivo-urna/…`, boletins de urna)
   and the open-data portal (`dadosabertos.tse.jus.br`, dataset `resultados-2026`) are the
   bulk, data-heavy source for post-election analysis.

## 6. Sources

- [TSE: Informações técnicas sobre a divulgação de resultados 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados) (403 to fetchers; open in a browser)
- [TSE: arquivos de divulgação de resultados (EA10/EA11/EA16/EA18/EA20 specs)](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados) `[VERIFY: download the spec PDFs manually and add them to docs/research/specs/]`
- [Portal de Dados Abertos: resultados-2026](https://dadosabertos.tse.jus.br/dataset/resultados-2026)
- [TSE results app](https://resultados.tse.jus.br/oficial/app/index.html)
- Reference product: seuimposto.com, "Apuração 2026 by pandora" (screenshot from the user, 2026-10-07)
