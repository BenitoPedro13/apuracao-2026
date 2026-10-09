# TASK: share metadata and the Open Graph image

Asked for by the user on 2026-10-09 ("i would love seo meta og images to share"), after
`TASK-urna-number.md`. On election night most visits arrive as a link in WhatsApp or X; today
the link unfurls as a bare URL with "Apuração 2026" and no image.

## 1. Current scenario

- `app/layout.tsx` sets only `title` and `description`. No `og:*`, no `twitter:*`, no
  canonical URL, no `robots.txt`, no image.
- The site is a static export served from the plan-B bucket
  (`https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/index.html`); CloudFront
  will change the origin later (`TASK-public-cdn.md` §8). Offices are `?cargo=` on one HTML
  file, so crawlers see one page and one set of tags.
- Next 16.4 generates `opengraph-image.tsx` at build time (statically optimized) when it uses
  no request-time API (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`),
  so it works with `output: "export"`. `scripts/deploy-web.ts` refuses files whose
  extension it has no content type for.

## 2. Planned changes

### 2.1 The image: an urna waiting for a vote, no numbers

1200 × 630 PNG, light theme tokens (`--paper`, `--panel`, `--ink`, `--ink-2`, `--confirma`):
the title "Apuração 2026" in Atkinson Hyperlegible Next Bold; "Presidente, governadores,
Senado e Câmara, com os arquivos do TSE" below it; on the right, the urna's screen with **two
empty digit boxes** (the page's signature, `TASK-urna-number.md`) above its three keys,
BRANCO, CORRIGE and CONFIRMA, in their own white, orange and green; along the bottom
"2º turno · domingo, 25 de outubro de 2026".
- **No vote counts and no candidate**: link previews are cached by WhatsApp and X for days,
  so a count in the image would be shared stale and read as the TSE's current number
  (invariant 1, the hard constraint). No party colour either: the image is neutral.
- Fonts from `apps/web/assets/fonts/` (Atkinson Hyperlegible Next 400/700, Mono 600, TTF,
  OFL 1.1 with its `OFL.txt`), read at build time.
- `opengraph-image.alt.txt`-equivalent `alt` export: "Apuração 2026: a tela da urna com
  duas casas vazias e as teclas Branco, Corrige e Confirma."

### 2.2 Tags (`app/layout.tsx`, `data/config.ts`)

- `metadataBase` = `NEXT_PUBLIC_SITE_URL`, default the plan-B origin (so CloudFront is a
  config change, like `NEXT_PUBLIC_DATA_BASE_URL`); canonical `/index.html` (the bucket's
  REST endpoint doesn't serve `/`).
- `title`, `description` (pt-BR, one sentence that says what the page does and whose data),
  `openGraph` (`website`, `pt_BR`, `siteName`, `url`), `twitter` (`summary_large_image`),
  `viewport.themeColor` per scheme (`--paper` light/dark).
- `app/robots.ts` (allow all, points at the sitemap) and `app/sitemap.ts` (one URL), both
  static.

### 2.3 Deploy

`scripts/deploy-web.ts` gets content types for whatever the build writes the image and
robots/sitemap as (`[VERIFY: the exported file names of opengraph-image, robots, sitemap]`
on the first build).

### 2.4 Alternatives considered and rejected

- **A live image with the current count** (rendered by the projector per `seq`): previews
  are cached far longer than a count lasts; see §2.1. It would also put an image renderer on
  the projector's path.
- **One image per office:** one HTML file serves every `?cargo=`; crawlers would only ever
  see one.
- **Candidate faces or numbers:** partisan in a preview, and photos are unlicensed.

## 3. Why

A shared link is how most people will arrive on the 25th; a preview that says what the page
is and that the data is the TSE's earns the click. Cost: ~2 hours, ~125 KB of fonts in the
repo (not shipped to readers), one PNG of ~80 KB.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/app/opengraph-image.tsx` | new | the image, built statically |
| `apps/web/assets/fonts/*` | new | Atkinson TTFs + `OFL.txt` |
| `apps/web/src/app/layout.tsx` | edit | metadata, viewport |
| `apps/web/src/app/robots.ts`, `sitemap.ts` | new | static |
| `apps/web/src/data/config.ts` | edit | `SITE_URL` |
| `scripts/deploy-web.ts` | edit | content types if needed |
| `.env.example` | edit | `NEXT_PUBLIC_SITE_URL` |
| `apps/web/e2e/dashboard.spec.ts` | edit | the tags and the image |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green; `out/` holds the PNG (1200 × 630).
2. e2e: `index.html` has `og:title`, `og:description`, `og:image` (absolute, under the site
   URL), `og:image:width` 1200, `og:image:height` 630, `og:image:alt`, `og:locale` pt_BR,
   `twitter:card` summary_large_image, a canonical link; the image URL answers 200
   `image/png` from the local export.
3. The image looked at, both as a full image and at WhatsApp's preview size (~400 px wide).
4. After the deploy (user): the live `og:image` answers 200 `image/png`; the page is checked
   in a link-preview debugger (the user pastes the link in a chat).

## 6. Outcome (2026-10-09, built and verified locally; deploy pending, run by the user)

- `[VERIFY]` §2.3 resolved: the export writes `out/opengraph-image` (no extension, PNG,
  1200 × 630, 79 KB), `out/robots.txt` and `out/sitemap.xml`; the tags name the image as
  `/opengraph-image?<16 hex>`, and the bucket's REST endpoint answers a bare query string like
  that with the object (checked on `index.html`: 200). `deploy-web.ts` types it by key
  (`image/png`) and `.xml`; the dry run lists all three.
- The route needs `export const dynamic = "force-static"` under `output: "export"` (the build
  refuses it otherwise, despite the docs' "statically optimized by default").
- e2e: the tags (absolute `og:image`, 1200 × 630, alt, `pt_BR`, `summary_large_image`,
  canonical `/index.html`) and the PNG itself. Gate green.
- Looked at full size and at 400 px (a WhatsApp preview): the title, the empty boxes and the
  three keys read at both; the footer was cut to one line each side ("2º turno · domingo,
  25/10/2026", "sem projeção") and the eyebrow no longer repeats "dados do TSE".
- CI went red on this commit from an older flake, not from it: the recorder's integration test
  slept a fixed 8 s before asserting the cold start's 8 blobs and saw 7 on the runner (twice
  today). It now waits until 8 are stored (≤ 30 s), then 2 s more; the assertions are
  unchanged. My gate command also piped through `tail`, so a red local run still committed;
  fixed by checking turbo's exit status before committing.
