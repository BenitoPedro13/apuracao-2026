# TASK: Studio credit in the footer

## 1. Current scenario

Both footers — the live page (`apps/web/src/app/page.tsx`) and the 1994–2022 archive
(`apps/web/src/components/history/history-page.tsx`) — carry the data and map sources.
Nothing credits who built the site.

## 2. Planned changes

- New `apps/web/src/components/studio-credit.tsx`: one line, "Desenvolvido por Blessed Moon
  Studio" (pt-BR, like the rest of the page), the name linking to
  `https://blessed-moon.vercel.app` in a new tab with an sr-only "(abre em nova aba)".
  Same `text-xs text-ink-2` as the source lines (5.7:1 on paper), underline on hover and a
  visible focus ring like the other links.
- Rendered as the last line of both footers, after the sources, so the credit never sits
  above the attribution to the TSE and IBGE.
- Not deployed by this task: `node scripts/deploy-web.ts` stays a user-run step.

## 3. Why

Requested by Benito (2026-10-10).

## 4. Affected files

| File | Change type | Notes |
|------|-------------|-------|
| `docs/tasks/TASK-studio-credit.md` | new | this document |
| `apps/web/src/components/studio-credit.tsx` | new | the credit line |
| `apps/web/src/app/page.tsx` | edit | last line of the live footer |
| `apps/web/src/components/history/history-page.tsx` | edit | last line of the archive footer |
