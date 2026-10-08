# 04 · Review of the reference site ("Apuração 2026 by pandora")

The visual reference named in `CLAUDE.md` §0. The user captured 7 screenshots and 5 JSON
responses from its network tab on 2026-10-08, after the 1st round (kept locally in
`docs/refs/`, gitignored: third-party material). This note lists what the site does, what
its data is, and what we can and can't take from it.

## 1. Its data (the JSONs)

| File | What it is |
|---|---|
| `agora.json` (25 KB) | Current state: `presidente`, `governador`, `senado` per `br`/UF: sections, totalized, electorate, turnout, blank, null, votes by candidate number, `situacao` (e.g. `segundo-turno`), `definido` (minutes, see below); `t`, `seq`, `recarregar` |
| `historico.json` (56 KB) | **247 points of the 1st round's night** (`t` 1042 → 1620), each with sections totalized and votes per candidate. `t` = minutes since 04/10 00:00 Brasília (`agora.t` 2211 = 05/10 12:51, the TSE's final re-totalization) |
| `municipios.json` (95 KB) | Columnar per municipality (5,570 + 186 abroad): `f` counted ‰, `l` leader number, `m` margin, `v` votes |
| `br.json` (10 KB) | Federal deputies: seats per party, per UF (vagas, eleitos, top candidate) |
| `busca.json` (1.2 MB) | 18,354 candidates: number, name, party, UF, office, votes, situation, TSE id |

Its design is close to ours (columnar map arrays, a small "now" object, a polled
sequence). The one dataset we lack is `historico.json`: a live recording of the TSE's
totals during the 1st round's night, which our recorder (started 10-08) never saw.

**We can't publish any of it.** It's a third party's derivative, unsigned, so none of its
numbers traces back to a TSE file (`CLAUDE.md` hard constraint, invariant 1), and it's not
ours to republish. It's usable only as:
- a design reference;
- an **internal cross-check** of our BU-receipt timeline (`TASK-bu-timelines.md`):
  totalization should lag BU receipt by minutes, and both must end at the same TSE totals.
  Never shown on the site.

## 2. Its features, and whether we build them

Per screen. "Plan" names where it lives in ours; the deadline (10-25) and the must-have cut
(`TASK-implementation-plan.md`) decide the column.

### President (`presidente-*.png`)

| Feature | Ours | When |
|---|---|---|
| Headline + top two (photo, %, votes, bar), difference in points and votes, other candidates, valid votes / turnout / blank+null | `result/president/br` has all of it (photos: `[VERIFY: TSE candidate photo URLs and their license]`) | must-have (web) |
| "2º turno · definido às 20h55" | the first published version whose candidates carry `e`/`st` saying so: a real TSE instant from our timeline, not our inference | should-have, with the timeline |
| Map: leader by municipality, intensity by margin buckets (10/25/45 points) | `map/president` (`leader`, `marginBpCalc`) + table alternative (invariant 7) | must-have |
| Map: "Estados" (by UF) | `result/president/{uf}` | must-have |
| Map: "Apurado" (% of sections counted) | `map/president.countedBp` already | must-have (cheap) |
| Map: "Vantagem" (spikes sized by vote margin) | margin in votes needs votes per municipality (have them per file) | nice-to-have |
| Map: "Candidato" (one candidate's share everywhere) | needs per-candidate share columns in the map view (2 candidates in the 2nd round: small) | should-have |
| UF labels with %, call-outs for small states, "Exterior" toggle | client only | must-have |
| Regions panel (leader, %) | `regions/president` | must-have |
| Regions "+3,7" next to the % | meaning unknown `[VERIFY: change vs what? 2022? the national %?]`; not built until known | — |
| "Ao longo da apuração" chart (share vs % of sections) | our timeline (live on the night) and the BU curves (1st round, 2022); **x = % of sections** is a good axis for the round comparison too | should-have |
| Timeline scrubber + "Ao vivo" | `?seq=` replay (architecture §6.4) | should-have |
| "Últimas atualizações" feed | the updates feed (architecture §5.3), facts only | should-have |
| Search (⌘K) | for the night: municipalities (index view) and the 2 + governor candidates | nice-to-have |
| "33 pessoas agora" | needs live presence on our compute (breaks invariant 5) | **no** (Umami's realtime count is private to the user) |
| Ads, sponsor banners | user decision: no ads | **no** |
| Share, full screen | client only | nice-to-have |

### Governors (`governadores.png`)

27 races in the 1st round with status chips, "closest races", map by leading party with
photos. Ours: governor views are should-have #7, and on the night only **7 runoffs** exist
(AC, AM, DF, ES, RJ, RN, TO). Feasible from `result/governor/{uf}` + municipalities.

### Senate and deputies (`senado.png`, `deputados.png`)

Hemicycles, left/centre/right blocs, seat counts, most voted. **Not on the night: the 2nd
round elects neither** (`architecture.md` §1 non-goals). For a 1st-round archive we'd need
to capture offices we never recorded (senate `c0005`, deputies `c0006`/`c0007`: the
recorder captured only president `c0001` and governor `c0003`), and the "bloc" grouping is
an editorial classification, not TSE data. Post-election at the earliest.

## 3. What this changes

- Web task docs (Phase 3) take the map modes (leader, UF, counted, candidate), the
  "Exterior" toggle and the small-state call-outs as requirements.
- The round comparison uses **% of sections** as an alternative x axis to minutes since
  close (`TASK-bu-timelines.md` §2.4).
- `historico.json` is kept locally as a cross-check for the BU curve, never published.
