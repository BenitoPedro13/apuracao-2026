# TASK: web shell, data hooks and the night's panels (Phase 3, must-have 2)

Phase 3 of `TASK-implementation-plan.md` (Mon 10-12 → **Sun 10-18**). `architecture.md` §6.4
(web app), §7.2 (missing ≠ zero ≠ failed), the user's global frontend rules
(`~/.claude/CLAUDE.md`), and the feature review of the reference site (research 04 §2).
The map itself (Canvas 2D, IBGE mesh) is `TASK-map.md`; this task builds everything around
it, including the map's **table alternative** (invariant 7), so the site is complete and
accessible even before the map lands.

## 1. Current scenario

- **Data is live and real:** `https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/`
  (plan B, `TASK-public-cdn.md` §8) serves the 1st round's final views under epoch
  `1t-final`: `data/v1/latest.json` (pointer, `max-age=5`), `data/v1/{epoch}/m/{seq}.json`
  (manifest, immutable), `data/v1/o/{sha256}.json` (114 views, immutable, gzipped). View
  names: `result/{president|governor}/{br|uf|zz}`, `regions/president`,
  `map-index/president`, `map/president`, `municipalities/{president|governor}/{uf|zz}`.
  Their Zod schemas are in `packages/contracts` (`ResultView`, `RegionsView`, `MapView`,
  `MapIndexView`, `MunicipalityView`, `Manifest`, `LatestPointer`, `ResultStatus`).
- **No `apps/web` yet.**
- **Hosting quirks of plan B:** the S3 REST endpoint doesn't map `/` to `index.html` (the
  entry URL is `/index.html` until CloudFront, `cdn=on`), and the data base URL will change
  when CloudFront arrives.
- **Toolchain facts, checked 2026-10-08** (npm, [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports),
  [`useTypeScriptCli`](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli), docs v16.4.0):
  `next` 16.4.0, `react` 19.3.0, `@tanstack/react-query` 5.104.1, `shadcn` 4.21.4,
  `tailwindcss` 4.3.3. With `output: 'export'`, Server Components run at build time; there
  are no rewrites, redirects, headers, ISR, Server Actions or default image optimization.
  **TypeScript 7:** `next build` type-checks with the project-local `tsc` CLI by default in
  16.4 (the TS 7 JS compiler API doesn't exist), labelled experimental; our own
  `check-types` task (`tsc --noEmit`) stays the gate. `eslint-config-next` may pull
  typescript-eslint, which doesn't support TS 7 (`CLAUDE.md` toolchain quirks): confirmed
  at scaffold (it depends on `typescript-eslint ^8.56`, peer TS `<6.1.0`), so it isn't used (§6).

## 2. Planned changes

### 2.1 Scaffold (`apps/web`), with the official generators

- `pnpm create next-app@latest apps/web` (App Router, TypeScript, Tailwind 4, `src/`), then
  align it with the monorepo: `@apuracao/config` tsconfig/eslint (keeping
  `@next/eslint-plugin-next`'s rules if `eslint-config-next` can't parse TS 7), turbo tasks
  `build`/`lint`/`check-types`/`test`.
- `next.config.ts`: `output: 'export'`, `images: { unoptimized: true }`,
  `reactCompiler: true` (stable in 16; it does the memoization the global rules forbid us
  from hand-writing), `trailingSlash: false` (one route, `/`).
- `pnpm dlx shadcn@latest init`, then only the components used. As built: `table`,
  `button`, `skeleton`; the UF picker is a native `<select>` and the toggles are buttons
  with `aria-pressed` (the plainest accessible element, and −35 KB gzip of Radix; §6).
  Tables: TanStack Table v9.
- `pt-BR` everywhere (`<html lang="pt-BR">`, `Intl.NumberFormat('pt-BR')`); dark and
  light themes from the system preference, both meeting AA contrast.

### 2.2 Data layer (`src/data/`): TanStack Query, one factory per endpoint

- **Base URL** from `NEXT_PUBLIC_DATA_BASE_URL` (plan B's S3 URL now, CloudFront later;
  a local `PUB_DIR` server in development).
- **Provider** per TanStack's Next.js pattern: a new `QueryClient` per server render (the
  build), one browser singleton. Defaults: `retry` with backoff, no refetch on focus for
  immutable data.
- **Factories** (`queryOptions`, key + fn together):
  - `pointerQuery()`: `refetchInterval` = the pointer's own `pollSeconds` (20 s),
    paused while the tab is hidden (`refetchIntervalInBackground: false`); parsed with
    `LatestPointer`.
  - `manifestQuery(epoch, seq)`: `staleTime: Infinity`; fetched 0–3 s after a new `seq`
    (random jitter, `architecture.md` §6.1 item 4).
  - `viewQuery(sha, schema)`: `staleTime: Infinity`; the body's SHA-256 (WebCrypto) must
    equal `sha` before it's parsed: a corrupted or mixed-up object is an error, never
    shown.
  - `epochsQuery()`: §2.3.
- **Hooks** (`src/hooks/`, every component goes through one): `useSelectedRound()`,
  `useManifest()`, `useResult(office, area)`, `useRegions()`, `useMunicipalities(office,
  area)`, `useMapFrame()` (for `TASK-map.md`), `useFreshness()`. Business rules live here
  once: the TSE's own percentage strings are shown as published (`pct.raw`, "45,16"),
  never recomputed; differences we compute (points, votes) are labelled ours; missing,
  zero and failed stay distinct (`ResultStatus`, invariant 6).
- **Keep the last good data** on any error (TanStack keeps `data`; the UI shows the
  error state next to it), the browser's stand-in for `stale-if-error` without CloudFront.
- No Zustand: nothing here ticks faster than the 20 s poll, and the pointer is server
  state.

### 2.3 Round selection ("1º turno" / "2º turno")

The pointer names one epoch. Decision (a) (`TASK-public-cdn.md` §6) keeps the 1st round's
final as the pointer until `6258` appears, then promotes `2t-1`; after that the 1st round
must stay reachable. So a small index, **`data/v1/epochs.json`** (`max-age=300`), lists the
published epochs and their final manifest: `{ "1t-final": { label: "1º turno",
manifest: sha, elections }, … }`. Written by `scripts/publish-epochs.ts` when an epoch is
seeded or promoted (an ops step, never by readers). The selector shows only the rounds
listed. The live round follows the pointer; a past round loads its fixed manifest.
Senate and deputies attach here later as more entries (research 04 §2, open data).

### 2.4 The page (`/`), must-have content

Server Components render the static frame at build time; the live parts are small client
leaves, per the global rules.

| Region | Content | Source |
|---|---|---|
| Header | title; office tabs (Presidente now, Governador when `TASK-governor` lands); round selector; status "Atualizado às hh:mm · TSE hh:mm · x% das seções"; share (Web Share API / copy link); full screen | pointer, `result/president/br` |
| Headline | the two leaders (name, party, number, TSE %, votes, bar), the difference in points and votes ("diferença", computed), the other candidates (TSE %), "todos os N candidatos", valid votes, turnout, blank + null; a 2nd-round line from the TSE's `situation` | `result/president/br` |
| Map slot | `TASK-map.md`; until then a placeholder pointing to the table | — |
| UF breakdown | a sortable table of the 27 UFs + Exterior: leader, %, sections counted; clicking a UF opens its municipalities | `result/president/{uf}` |
| Municipalities | the table alternative: one UF at a time, searchable by name, sortable, leader, %, sections, status | `municipalities/president/{uf}` |
| Regions | the 5 regions + Exterior, leader and %, labelled as our sum (`architecture.md` §7.4) | `regions/president` |
| Exterior toggle | shows or hides abroad in the tables and the map | client |

States, always visible (`architecture.md` §6.4, §7.2): before publication ("ainda não
publicado"), counting, final; freshness amber after 3 min without a new `seq` and red
after 10 min ("atualização interrompida", with `pointer.health`); a failed view shows its
error, never zeros. Party colours are never the only cue: every coloured value carries its
name or number.

Layout slots, not built here: timeline and comparison (`TASK-bu-timelines.md` + its UI),
updates feed, governor views.

### 2.5 Deploy (`scripts/deploy-web.ts`)

`next build` → `out/` → the public bucket: hashed `_next/static/**` first
(`immutable`), then HTML (`max-age=60`), never touching `data/`. Text is uploaded gzipped
with `Content-Encoding: gzip` (S3 doesn't compress; uncompressed, the JS alone took 4.3 s
on the throttled profile). **No `--delete` at the
bucket root** (it would remove the published data). Plan B entry:
`…/index.html`. Umami: the user's account, a new site `[VERIFY: script URL and that it
runs from an S3/cloudfront.net host]`.

### 2.6 Rejected

- *SSR / ISR / a Node server:* readers must never touch our compute (invariant 5).
- *SSE/WebSocket push:* `architecture.md` ADR-8; the pointer poll costs nothing at any
  audience.
- *Zustand/Redux:* no state here changes faster than the poll (global rules).
- *A hand-rolled combobox/table:* shadcn (Radix) and TanStack Table (global rules).
- *Recomputing percentages client-side:* the TSE's strings are the published numbers.
- *Candidate photos now:* the TSE serves them (`ele-c` catalog: `…/<cd_eleicao>/fotos/<uf>`)
  but their reuse terms aren't checked `[VERIFY: license]`; initials until then.

## 3. Why

It's must-have 2: without it there's nothing to look at on the night. It also gives the
two weeks before the 2nd round a real page (the 1st round's final results). Cost: ~3 days;
$0 to host (the bucket already exists).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/**` | new | `create-next-app`, shadcn, §2.1–2.4 |
| `scripts/publish-epochs.ts`, `scripts/deploy-web.ts` | new | §2.3, §2.5 |
| `packages/contracts/src/views/epochs.ts` | new | `EpochsIndex` schema |
| `pnpm-workspace.yaml`, `turbo.json` | edit | `apps/web`, its `out/` as build output |
| `README.md`, `.env.example`, `docs/architecture.md` §6.2/§6.4 | edit | `NEXT_PUBLIC_DATA_BASE_URL`, `epochs.json`, deploy |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green, including `apps/web` (Vitest for
   hooks and formatting, against the **real** seeded views copied from
   `.replay/real/pub`, never hand-built fixtures).
2. Against the live bucket, the built page shows exactly the TSE's numbers: Lula
   **45,16%** and **53.879.538** votes, Flávio Bolsonaro **47,03%** and **56.104.503**,
   valid votes and turnout equal to `result/president/br`, every UF row equal to its view
   (Playwright reads the DOM and compares with the JSON).
3. Polling: the network log shows `latest.json` every 20 s ± 1 s with the tab visible and
   none while hidden; a view whose bytes don't hash to its name is rejected (test with a
   tampered local copy).
4. States: serving a pointer whose `refreshedAt` is 4 and 11 minutes old turns the status
   amber and red; a missing view shows its error state, not zeros.
5. Accessibility: `@axe-core/playwright` reports **0 violations** (WCAG 2.2 AA rules) on
   the page in both themes; every control reachable and operable by keyboard (Playwright
   tab-walk); `prefers-reduced-motion` disables transitions.
6. Performance (3 runs, median, `architecture.md` §9.3): on "Fast 4G" + 4× CPU, the shell
   is interactive ≤ 2.5 s; first-load JS ≤ 260 KB gzipped, of which ≤ 80 KB ours,
   excluding every lazily loaded feature chunk (revised 2026-10-08, see §6 item 6).
7. Deploy: `…/index.html` loads from the bucket, `_next/static` objects are `immutable`,
   and `data/v1/latest.json` is unchanged by the deploy (same ETag before and after).

## 6. Outcome (2026-10-08)

Built in three commits (`abea501` scaffold, `4a0035f` data layer and panels, then this
one). What changed from the plan, and the measurements:

- **Lint:** `eslint-config-next` replaced by its plugins (`@next/next` core-web-vitals,
  `react-hooks`, `jsx-a11y` strict) on the Babel base; a probe file confirmed all three
  fire under ESLint 10. The shared config had a latent bug: Babel resolved its preset from
  each package's cwd, which only worked through hoisting; it now resolves by path.
- **Polling, two bugs found by the e2e test:** (1) every `useQuery` observer with a
  `refetchInterval` runs its own timer, and staggered timers don't dedupe: one poller
  (`usePointerPolling`, mounted once) now owns the interval and readers use the cache;
  (2) the pointer's `stale-while-revalidate=30` made each poll return the *previous* copy
  (a browser revalidation followed 40 ms later), so updates arrived one poll late: the
  pointer is fetched with `cache: "no-cache"` (a 304 when unchanged). TanStack restarts
  the interval when a response lands, so the period is 20 s from each response.
- **Freshness** is measured on `refreshedAt` and `health.recorderSeenAt` (the pipeline's
  heartbeats, since a quiet TSE makes no new `seq`), on the server's clock plus local
  elapsed time, and is never amber/red for a `final` national result or a past round
  (otherwise the 1st round's final, with the projector off, would show red forever).
- **Missing ≠ zero:** numbers show for `counting`, `final`, and `fetch_failed` with its last
  good file (dimmed); never for `no_sections` or `not_published`. Missing values sort last
  in every table; an exact municipal tie shows "Empate".
- **Shared code:** `viewKey`/`manifestKey`/`POINTER_KEY` moved from the projector to
  `contracts`; `EpochsIndex` + `EPOCHS_KEY` added; `@apuracao/tse/codes` subpath export.
- **Published (2026-10-08, approved by the user):** `epochs.json` lists `1t-final`
  ("1º turno", president 6257, governor 6259) at seq 11,387 with the pointer's manifest
  hash; the first deploy put 25 immutable + 12 short-lived objects, nothing under `data/`.
  The site is at
  `https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/index.html`.
- **Not done here:** Umami (`[VERIFY]` stays); candidate photos (initials, §2.6).

### Verification results (§5)

1. `pnpm turbo run lint check-types test build`: green. Web unit tests 13/13 (Vitest on the
   real views in `apps/web/test/real/`), contracts 37/37.
2. Playwright against the live bucket: Lula 45,16% / 53.879.538, Flávio Bolsonaro 47,03% /
   56.104.503, valid votes and turnout, and all 28 UF rows (leader, TSE %, sections) equal
   their views. ✓
3. `latest.json` 20,018–20,024 ms from each response to the next request with the tab
   visible, 0 requests in 45 s hidden; a tampered view (one digit changed) is rejected with
   the error state and its number never appears. ✓
4. A real replay manifest (national `not_published`) with the pointer 4 and 11 min old:
   "Aguardando dados do TSE", "Atualização atrasada" / "Atualização interrompida", no
   "votos" anywhere; a 403 on the national view shows its error, no "%". ✓
5. axe (WCAG 2.0/2.1/2.2 A+AA tags): **0 violations**, light and dark; a Tab walk reaches
   every control, Enter on "Acre: ver municípios" lists its 22 municipalities;
   `prefers-reduced-motion` sets transitions to 0.01 ms. ✓
6. DevTools "Fast 4G" (165 ms, 9 Mbps ×0.9, from its source) + 4× CPU, loopback data,
   cold cache, 3 runs: national headline **1,743–2,000 ms** median (two runs of the suite),
   UF table complete 2,158–2,445 ms. ✓ **First-load JS: 253 KB gzip, over the 150 KB
   target** ✗: React DOM + the Next 16 runtime are ~174 KB of it before any of our code
   (unchanged since the empty scaffold); ours is ~79 KB (TanStack Query + Table, Zod, the
   app), after removing Radix Select/Toggle/ToggleGroup (−35 KB) and the TSE time-zone table
   (−20 KB). The 150 KB target was set without a measurement. **Revised (user,
   2026-10-08):** the budget covers only what the headline needs to appear, ≤ 260 KB total
   and ≤ 80 KB ours, with the 2.5 s time-to-headline as the real gate. Most of the
   dashboard is still to come (map, timeline and scrubber, turnout, charts, governor
   views), and the total JS will grow well past 260 KB. So every feature after this one
   loads as its own lazy chunk (`next/dynamic` or a dynamic `import()`), stays out of the
   first load, and its task doc sets and measures its own gzip budget. A feature that
   needs to be in the first load has to fit the 80 KB or argue for raising it.
7. Deploy (live bucket): `index.html` 200, `text/html`, gzip, `max-age=60`; its 9
   `_next/static` assets all 200, `max-age=31536000, immutable`; `data/v1/latest.json`
   ETag `"18772c75…"` before and after (unchanged); `epochs.json` 200, `max-age=300`.
   Headless Chromium on the deployed URL (cold, from NL): Lula 45,16% / 53.879.538 and
   Flávio Bolsonaro 47,03% / 56.104.503 after 7.8 s, 0 console errors or failed requests. ✓

Observed from this machine (NL, 0.23–1.2 s connect to sa-east-1): plan B's S3 endpoint is
HTTP/1.1 (6 connections), so the 33 views of a cold load take ~6 serial rounds, ~11 s here.
For viewers in Brazil it's a fraction of that, but two follow-ups would cut it everywhere:
CloudFront (`cdn=on`, HTTP/2), and a single `states/president` summary view in the
projector to replace the UF table's 28 requests.
