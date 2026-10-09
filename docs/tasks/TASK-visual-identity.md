# TASK: visual identity and the dashboard layout (Phase 3)

Companion to `TASK-map.md`. The web shell (`TASK-web-shell-and-data-hooks.md`) built the
panels with shadcn's default neutral theme and Geist; the map now arrives as the page's
centre, and the user asked (2026-10-08) for UI/UX to be treated **as importantly as the
engineering**. This task gives the page a deliberate identity and the reference site's
information architecture (research 04), without copying its look.

## 1. Current scenario (screenshots taken 2026-10-08, live data, 1440 × 1000 dark and 412 × 915 light)

- **A real bug, missed by the e2e suite:** at 412 px the headline's two-column block is
  wider than the viewport. Lula's column, the difference and "Comparecimento" are cut off
  and the page scrolls sideways. Cause: the `<main>` grid has no explicit mobile track, so
  its implicit `auto` column grows to the content's min-content width (two `text-4xl`
  percentages side by side); grid items default to `min-width: auto`.
- **Hierarchy:** three equal-weight cards in a row, then two long tables. Nothing says
  "this is the count of an election"; it reads as a generic admin template (shadcn
  neutrals, Geist, rounded cards everywhere). The map slot is an empty card.
- **Numbers:** the two percentages are the loudest thing on the page, which is right, but
  they're set in the same family as every label, and nothing distinguishes the TSE's
  numbers from ours except the word "calculada" in places.
- **Header:** title + "Presidente" + status + three buttons; no sense of which office or
  round you're on beyond small text.

## 2. Planned changes

### 2.1 The brief, pinned

- **Subject:** the live count of Brazil's 2026 presidential runoff (and its 1st-round
  archive), from the TSE's own files.
- **Audience:** Brazilians following the count on election night, most on phones, many
  of them older readers on small screens; journalists checking a municipality.
- **The page's single job:** who's ahead, by how much, how much is counted, and **that
  these are the TSE's numbers**.

### 2.2 Tokens

**Type: the Atkinson Hyperlegible family** (Braille Institute, OFL, on Google Fonts and
in `next/font` 16.4 as variable fonts). Chosen for the audience, not the trend: it was
drawn so that easily confused glyphs (0/O, 1/l/I, 6/8, 3/8) stay distinct at small sizes
for low-vision readers. On a results page, a misread digit is a misread result.
- **Atkinson Hyperlegible Next** (variable, 200–800): UI and headings. Candidate names in
  the headline at 650 with −1% tracking; labels at 400.
- **Atkinson Hyperlegible Mono** (variable, 200–800): **every number the TSE publishes**
  (votes, percentages, sections, times). This is the identity's one risk: the numbers look
  like the **boletim de urna**, the monospaced thermal receipt every voting machine
  prints at 17:00, which is the physical origin of every vote on the page. Monospace also
  makes columns of numbers align with no `tabular-nums` tricks.
- Scale (rem): 0.75 · 0.875 · 1 · 1.25 · 1.75 · 3.5 (the two headline percentages; 2.75
  on phones). Line height 1.15 for numbers, 1.45 for text.

**Provenance as typography (the signature):** the page distinguishes the TSE's numbers
from ours with type, consistently, everywhere:
- **TSE numbers:** Mono, solid.
- **Our numbers** (differences, regions, margins, municipality counts): Mono with a
  **dotted underline** and a "calc." tag on first use in a panel; hovering or focusing
  one shows how it was computed ("diferença entre os votos de PL 22 e PT 13 sobre os
  votos válidos"). The footer explains the convention once.
This turns an invariant the project already lives by (ADR-12, "everything we compute is
labelled") into the thing people remember the site by.

**Colour.** Neutrals are deliberately quiet because the data carries the colour:
| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F4F6F7` | `#0E1214` | page background (cool graphite / cool paper, never cream or pure black) |
| `--panel` | `#FFFFFF` | `#161B1E` | panels |
| `--line` | `#D9DFE3` | `#283036` | hairlines, borders |
| `--ink` | `#11171A` | `#E9EEF0` | text |
| `--ink-2` | `#56636B` | `#93A0A8` | secondary text (≥ 4.5:1 on `--panel`, checked by axe) |
| `--pt` / `--pl` | `#C62828` / `#1D4ED8` | `#F0605D` / `#5B8DEF` | the two runoff parties: text, bars, the map's strongest step |
| `--confirma` | `#1B7F4B` | `#3CC27E` | "definido"/final states only: the green of the urna's CONFIRMA key |
| `--warn` | unchanged | unchanged | freshness amber |

Map ramps (4 steps per party, from `--panel`-tinted to the party colour) are derived in
OKLCH so the steps are evenly spaced in lightness; their exact values are in
`globals.css` with the contrast checks noted next to them.

**Shape:** radius 10 px on panels, 6 px on controls; no shadows; panels separated by
hairlines and 16 px gaps. Focus rings 2 px `--ink` with a 2 px offset, always visible.

### 2.3 Layout

Desktop ≥ 1280 px: a dashboard that fits the viewport (`100dvh` minus the header), like
the reference, so the whole night reads at a glance; each column scrolls on its own if it
overflows.
```
┌ Apuração 2026 │ Presidente │ 1º turno ▾ ─────────── ● Atualizado 12:51 · TSE │ Exterior │ ⤴ │ ⛶ ┐
├──────────────────┬──────────────────────────────────────────┬──────────────────┤
│ Presidente·Brasil│ Quem lidera · Por estado · Apurado   legend│ Por região       │
│ FLÁVIO   LULA    │                                          │ N  PL 49,15%     │
│ 47,03%   45,16%  │              M A P                 RN ▪  │ NE PT 63,77%     │
│ ███████ │ █████  │                                    PB ▪  │ …                │
│ diferença calc.  │                                    …     │ Exterior         │
│ others · totals  │ [+][−][Brasil] [Ir para o estado ▾]       │                  │
├──────────────────┴──────────────────────────────────────────┴──────────────────┤
│ Por estado (table)                    │ Por município (table, ?uf=)             │
└───────────────────────────────────────┴────────────────────────────────────────┘
```
Columns: 22rem · 1fr · 18rem. 1024–1279: headline and regions stack in a left column,
the map takes the rest. < 1024: one column in reading order (headline, map, regions,
tables); **every grid track `minmax(0, 1fr)` and every child `min-w-0`** (the bug above),
plus a Playwright check that `document.documentElement.scrollWidth === innerWidth` at
320, 375, 412 and 768 px.

Office tabs ("Governadores", "Senado", "Deputados") appear only when each ships (Senado
and Deputados are the next task, 10-09: user). No dead tabs.

### 2.4 Copy

Sentence case, plain verbs, the reader's words: "Quem lidera", "Apurado", "Ir para o
estado", "Ver municípios", "Tentar de novo". Errors say what happened and where the same
numbers are ("O mapa não carregou. Os mesmos resultados estão nas tabelas abaixo.").
Candidate names as the TSE spells them, title-cased (already `displayName`).

### 2.5 Alternatives considered and rejected

- **The reference's look** (near-black, serif display, photos): it's theirs, and a serif
  display adds nothing for this audience that legibility doesn't do better.
- **Keeping Geist:** neutral and well made, but it's the scaffold default, so it says
  nothing about this subject.
- **A Brazilian flag palette (green/yellow accents):** politically loaded in 2026 (both
  camps claim the flag's colours), so it would read as partisan. The only green is the
  urna's CONFIRMA key, used only for "definido".
- **A theme toggle:** the system preference stays the only switch (decided in the web
  shell task); both themes are designed, not inverted.

## 3. Why

The data is correct and accessible already; this makes it legible at a glance on a phone
at 22:00, gives the map the centre it needs, fixes a real mobile bug, and makes the
project's core promise (real TSE numbers, ours labelled) visible instead of buried in
footnotes. Cost: two font files (~60 KB woff2, subset `latin`, `display: swap`, not JS),
and touching every component's class names.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/app/globals.css` | edit | tokens (§2.2), map ramps, provenance styles |
| `apps/web/src/app/layout.tsx` | edit | Atkinson Next + Mono via `next/font/google` |
| `apps/web/src/app/page.tsx` | edit | the grid (§2.3), `min-w-0` |
| `apps/web/src/components/*.tsx` | edit | type roles, `Num`/`Calc` primitives |
| `apps/web/src/components/num.tsx` | new | `<Num>` (TSE) and `<Calc how="…">` (ours) |
| `apps/web/e2e/dashboard.spec.ts` | edit | no horizontal scroll at 4 widths; axe both themes |
| `README.md` | edit | screenshot-free status line update |

## 5. Verification

1. No horizontal scroll at 320, 375, 412, 768, 1024, 1440 px (Playwright).
2. axe 0 violations in both themes (contrast of every token pair included).
3. Every number computed by us renders as `<Calc>` (a unit test over the rendered
   headline and regions: the difference, the region %s and the municipality counts carry
   the dotted style and an accessible description), and no TSE number does.
4. Screenshots at 1440 × 1000 and 412 × 915, both themes, looked at and critiqued against
   §2.1's single job before calling it done.
5. First-load JS unchanged (fonts are CSS/woff2); `pnpm turbo run lint check-types test build` green.

## 6. Outcome (2026-10-08)

Built together with the map (`TASK-map.md`), since the map needed the palette. As built:

- **Tokens** in `globals.css` as planned; shadcn's variables point at them, so its
  button/table/skeleton took the identity unchanged. Contrast, computed (not estimated):
  `--ink-2` 6.2:1 on the light panel, 5.7:1 on light paper, 6.5:1 on the dark panel; the
  party colours 5.4–6.7:1; the strongest map steps 5.4–7.6:1; the country outline 3.0:1
  (light) and 3.6:1 (dark, raised from 2.45:1 when computed).
- **Type:** Atkinson Hyperlegible Next and Mono via `next/font` (Next warns it has no
  fallback metrics for them; `display: swap` stands). **Mono only for the numbers, never
  whole phrases:** the first screenshot set "1,87 pontos · 2.224.965 votos" in Mono, and it
  wrapped. The headline percentages are Mono 2.5 rem with a 0.45 em "%" (at Mono's width,
  3.5 rem made the two candidates overlap in the 22 rem column).
- **Provenance:** `<Num>` (TSE) and `<Calc how>` (ours: dotted underline, a `title` saying
  how, "(calculado)" for screen readers) in `components/num.tsx`, used in the headline,
  the regions, the map's legend and card. The footer explains the convention once. A
  `title` is mouse-only, so the sr-only text and the footer carry it for everyone else.
- **Layout** as §2.3; the mobile overflow is fixed (every track `minmax(0, …)`, cells
  `min-w-0`) and tested at 320–1024 px (`e2e/map.spec.ts`). Not done: the viewport-height
  dashboard (the columns are as tall as their content; the map is capped at 80 dvh).
- **Not done here:** the dashboard's own e2e axe runs on the full page unchanged; the
  whole-page screenshot critique at 412 px found the UF table's numeric columns behind a
  horizontal scroll inside their panel (no page overflow), left for the tables' polish.
