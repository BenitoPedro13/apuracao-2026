# TASK: the archive's own page and Open Graph image

Asked for by the user on 2026-10-13 ("eu quero uma imagem própria pro histórico"), after
`TASK-share-metadata.md` (the home's image) and `TASK-historical-presidential.md` (`?historico`).

## 1. Current scenario

- The archive is `index.html?historico`: the same HTML file as the live page, swapped on the
  client by `ModeSwitch` (`useHistoryMode()` reads `?historico`). Link-preview crawlers
  (WhatsApp, X, Telegram) fetch the HTML and read the `<meta>` tags without running JS, and
  a query string doesn't change the file. So a shared archive link unfurls with the home's
  title, description and image ("Apuração 2026 … 2º turno · domingo, 25/10/2026"), which is
  wrong for a page about 1994–2022.
- `TASK-historical-presidential.md` §2.4 rejected `/historico` as a route: "impossible on plan
  B (no index documents)". That is true of a *directory* URL (`/historico/`), not of a *file*:
  the bucket's REST endpoint serves `/index.html` today, so it serves `/historico.html` the
  same way. With `trailingSlash: false`, `app/historico/page.tsx` exports `out/historico.html`
  (+ `historico.txt`, its RSC payload), and `app/historico/opengraph-image.tsx` exports
  `out/historico/opengraph-image`.
- Related: the header's `<Link href="/?historico">` (and the archive's `<Link href="/">`)
  soft-navigate, so the address bar reads `/?historico`. On the bucket that URL has no object:
  reload or copy-paste lands on S3's `AccessDenied` (the XML the user pasted is that response
  for the bucket root). A real, copyable URL for the archive fixes it for the archive; the
  live page's own `/` is a separate, existing limit of plan B (`TASK-public-cdn.md` §8).

## 2. Planned changes

### 2.1 A real page: `/historico.html`

- `app/historico/page.tsx`: renders `<HistoryPage />` directly (no `ModeSwitch`), with its own
  `metadata` (title "Eleições anteriores · Apuração 2026", a pt-BR description about the eight
  presidential elections 1994–2022 from the TSE's archive, canonical `/historico.html`,
  `openGraph.url`, `twitter` large card). The image comes from the route's own
  `opengraph-image.tsx`; Next names it `/historico/opengraph-image?<hash>` in the tags.
- **Old links keep working:** `index.html?historico` and `?historico&ano=…` still switch to the
  archive on the client (`ModeSwitch` stays), so nothing already shared breaks. Only their
  *preview* stays the home's (they can't have another); new shares use `/historico.html`.
- **Links inside the site use the new URL, as plain anchors** (`<a href="/historico.html">`,
  and `/index.html` back), not `next/link`: a full load puts a URL that exists in the bar,
  so "Compartilhar" (`window.location.href`) copies something the bucket can serve. The cost
  is one full page load per switch (the app shell is ~tens of KB and cached 60 s).
  `?ano=` and `?mun=` keep working: `setUrlParams` uses `window.location.pathname`.
- **Pointer polling:** `PointerPoller` moves out of `Providers` (every route) into the live
  page, so `/historico.html` never polls the live pointer (the archive never changes); it
  keeps its `?historico` gate for the old links.

### 2.2 The image: eight elections, no numbers

1200 × 630 PNG built the same way as the home's (`ImageResponse`, same fonts and light-theme
tokens, `force-static`): eyebrow "Presidente · Brasil", title **"Eleições anteriores"**
(Bold, ~100 px), subtitle "Oito eleições para presidente, município por município, com os
arquivos do TSE.", and on the right a panel with the eight years as a timeline
(1994 · 1998 · 2002 · 2006 · 2010 · 2014 · 2018 · 2022, Atkinson Mono) on the same white
panel / `LINE` border as the urna on the home, so the two images read as one family. Footer
line like the home's: "1994–2022" left, "arquivo do TSE" right.
- **No vote counts, no candidates, no party colours:** same reasons as `TASK-share-metadata.md`
  §2.1 (previews are cached for days; the image is neutral). The years are structure, not
  data. This is also why no map thumbnail: it would need a colour per municipality.
- `alt`: "Eleições anteriores: as oito eleições presidenciais de 1994 a 2022, município por
  município."
- The two images share the frame (paper background, fonts, footer rule). Extract
  `app/og-frame.tsx` (fonts loader + tokens + footer) only if the duplication is real once
  both files exist; otherwise keep two plain files (restraint).

### 2.3 Deploy and tests

- `scripts/deploy-web.ts`: `historico.html` / `.txt` are already typed (`.html`, `.txt`);
  `[VERIFY: the exported name of the route's image, expected historico/opengraph-image, no
  extension]` on the first build. `BY_KEY` matches the bare key `opengraph-image` only, so it
  becomes "basename is `opengraph-image`" (the dry run must list both images as `image/png`).
- `app/sitemap.ts` adds the second URL; `robots.ts` unchanged.
- e2e: `PAGE` in `history.spec.ts` moves to `/historico.html`; one test keeps
  `/index.html?historico` (old links); a new test reads the archive page's tags (own `og:title`,
  absolute `og:image` under the site URL ending in `/historico/opengraph-image…`, 1200 × 630,
  canonical `/historico.html`) and fetches the image (200, `image/png`), and asserts the
  live page's `og:image` is still the home's.

### 2.4 Alternatives considered and rejected

- **Keep `?historico` and swap the image from JS:** crawlers don't run JS; it would change
  nothing for previews.
- **A redirect/stub HTML per link (`share/historico.html` with tags + meta refresh):** a
  second source of truth for the tags, and the redirect hop breaks "Compartilhar" copying the
  real URL. A route is the generator's own answer.
- **Generating one HTML per year (`/historico/2006.html`) with a year-specific image:** the
  right shape if per-year sharing matters, but eight more pages and eight images two weeks
  before the 2nd round. Left open; this task only creates the first page, so adding years later
  is more of the same.
- **Dropping `?historico` for `/historico.html` only:** would break every link already
  shared. Kept as a compatibility path.
- **A census-style map or the PT/rival split in the image:** partisan colour in a preview and
  a per-municipality render at build time for little gain (see §2.2).

## 3. Why

A link to the archive is the one people will post in the days between the rounds ("compare
com 2022"); today it advertises the 2026 count instead of the archive. Cost: ~1.5 hours, one
~60 KB PNG, one more HTML file (+ payload) in the export. Risk: the route and the
`?historico` path must render the same page, so the e2e covers both; the live page's first
load is unchanged (no archive code is added to it).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/app/historico/page.tsx` | new | `<HistoryPage />`, own metadata, Suspense for the client leaves |
| `apps/web/src/app/historico/opengraph-image.tsx` | new | the archive's image, built statically |
| `apps/web/src/app/page.tsx` | edit | header link to `/historico.html` (plain anchor); `PointerPoller` rendered here |
| `apps/web/src/app/providers.tsx` | edit | `PointerPoller` out of the provider (every route) |
| `apps/web/src/components/history/history-page.tsx` | edit | back-links to `/index.html` (plain anchors) |
| `apps/web/src/app/sitemap.ts` | edit | second URL |
| `scripts/deploy-web.ts` | edit | content type for any `…/opengraph-image` |
| `apps/web/e2e/history.spec.ts` | edit | new URL, old-link test, tags and image test |
| `apps/web/e2e/dashboard.spec.ts` | edit | only if it asserts the header link |
| `docs/tasks/TASK-historical-presidential.md` | edit | §2.4 "impossible" corrected: a file route is possible |
| `docs/tasks/TASK-share-metadata.md` | edit | pointer to this task |
| `README.md` | edit | archive URL in the table |
| `CLAUDE.md` | edit | status line: the archive's page and image |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green (turbo's exit status checked before any
   commit); `apps/web/out/` holds `historico.html`, `historico.txt` and the archive's image
   (PNG, 1200 × 630).
2. e2e (built export): the archive page's tags as in §2.3; `/index.html?historico` still shows
   the archive; the live page's tags unchanged; axe clean on both archive URLs.
3. The image looked at full size and at ~400 px (a WhatsApp preview): the title and the eight
   years read at both.
4. `pnpm exec node scripts/deploy-web.ts --dry-run` lists `historico.html`, `historico.txt` and
   `historico/opengraph-image` with the right types and cache control.
5. After the deploy (the user runs it): `…/historico.html` answers 200 `text/html`, its
   `og:image` answers 200 `image/png`, and the link pasted in a chat shows the new card.
