# TASK: election-night status copy and "Desde o 1º turno" (2026-10-25)

Written during the 2nd-round count, after comparing the site with pandora's (screenshot the
user shared at ~17:30 BRT). The site is inside the deploy freeze (10-24 → 10-26 12:00); the
user deploys it by hand.

## 1. Current scenario

- From 17:06 to past 17:30 the TSE published nothing new. Our status line said
  "Atualizado às 17:3x · TSE 25/10 17:06": nothing tells a reader the *TSE* is the one
  waiting (our pipeline was fine, so no amber/red either).
- At 0.24% of sections counted the headline shows "Lula 57,66%" with no warning that a
  count this early says little.
- Nothing compares the 2nd round with the 1st, although the 1st-round epoch is already
  loaded by the site (`useFirstRoundManifest`, for the legislative archive).

## 2. Planned changes

1. **"Aguardando novos votos do TSE desde hh:mm"** (`data/rules.ts` `tseQuiet`,
   `hooks/use-freshness.ts`, `components/status-line.tsx`): when our pipeline is `ok`, the
   round is live and the national file is `counting`, and the TSE's generation time
   (`dg`+`hg`) is ≥ 3 min behind the server clock, a second line says so. Same 3 min as
   `AMBER_AFTER_MS`. Not shown before the first count or once `final`.
2. **"Ainda é cedo: menos de 1% das seções apuradas"** (`data/rules.ts` `earlyCount`,
   `components/headline.tsx`): while `counting` and the TSE's `countedPct` < 1,00.
3. **"Desde o 1º turno"** panel (`data/rules.ts` `marginShift`, `hooks/use-data.ts`
   `useFirstRoundResults`, `hooks/use-since-first-round.ts`,
   `components/since-first-round.tsx`, `app/page.tsx`): per UF with 2nd-round numbers, the
   change in the margin between the two 2nd-round candidates, in percentage points of
   valid votes: (L₂ − F₂) − (L₁ − F₁), from the TSE's own percentages, candidates matched
   by number. Two lists, "a favor de Lula" / "a favor de Flávio", top 5 each, with each
   UF's % apurado. Marked as our calculation (`Calc`). UFs with no sections are counted,
   not listed (missing is not zero). Shown only when the live round is the 2nd.

4. **Headline columns level** (`components/headline.tsx`, user, ~17:45): "Flavio Bolsonaro"
   wraps to two lines and pushed his %/votes a line below Lula's. Both columns now share one
   row grid (`grid-rows-subgrid`, 4 rows); the inner column is `minmax(0,1fr)` so the
   unbreakable urna boxes + "Bolsonaro" (154 px in a 147 px column at xl) spill into the gap,
   not past the panel. Measured: equal tops for % and votes at 1600/1280/390 px.

Rejected: pandora's "Projeção" (an extrapolated final result: not a TSE number, breaks
invariant 1). Comparing each candidate's own % across rounds: both always "grow" (the 1st
round split valid votes among more candidates), so the margin is the honest measure.

## 3. Why

Tells readers *why* nothing moves when the TSE is quiet, guards against reading a 0.2%
count as a result, and adds the comparison readers ask for. Cost: three small pure rules
with tests, one panel; 27 extra small view fetches (the 1st round's UF results, immutable,
cached).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/data/rules.ts` | edit | `tseQuiet`, `earlyCount`, `marginShift` |
| `apps/web/src/data/rules.test.ts` | edit | tests on the real 1st-round views |
| `apps/web/src/hooks/use-freshness.ts` | edit | exposes `tseQuietSince` |
| `apps/web/src/components/status-line.tsx` | edit | the waiting line |
| `apps/web/src/components/headline.tsx` | edit | the early-count note; columns on a shared subgrid |
| `apps/web/src/hooks/use-data.ts` | edit | `useFirstRoundResults` |
| `apps/web/src/hooks/use-since-first-round.ts` | new | rows for the panel |
| `apps/web/src/components/since-first-round.tsx` | new | the panel |
| `apps/web/src/app/page.tsx` | edit | places the panel |

## 5. Verification

- `pnpm turbo run lint check-types test build --filter=web`
- The built site against the live bucket: the waiting line while the TSE is quiet, the early
  note under 1%, and the panel's numbers checked by hand for two UFs against
  `result/president/<uf>` of `1t-final-2` and `2t-2`.
