# TASK: the candidate's number as the page's signature ("o número na urna")

Design pass asked for on 2026-10-09 (`/frontend-design`) after `TASK-visual-pass-2.md`. It
keeps the identity of `TASK-visual-identity.md` (Atkinson Hyperlegible, cool paper, provenance
as typography, the CONFIRMA green only for "definido") and spends its one risk in one place.

## 1. Current scenario

- **Brief, unchanged:** the live count of the 2026 runoff and its 1st-round archive, from the
  TSE's own files; Brazilians on election night, mostly on phones, many older; the page's
  job is who's ahead, by how much, how much is counted, and that these are the TSE's numbers.
- **What reads as generic today** (screenshots in `TASK-visual-pass-2.md` §6): the candidate
  mark is initials in a party-coloured ring ("FB", "L", "DR"), the default stand-in for a
  missing photo on any dashboard; lists mark a party with an 8 px dot; the "Eleito" state is
  plain text. Nothing on the page could only belong to a Brazilian election.
- **What the subject already has:** a Brazilian votes by typing a **number** into the urna.
  The urna's screen shows one box per digit (2 for president and governor, 3 for senator, 4
  for federal deputy, 5 for state deputy); the first two digits are the party's. Its keypad
  has three coloured keys: BRANCO (white), CORRIGE (orange), **CONFIRMA (green)**. Every
  candidate in our views carries that number (`n`), from the TSE file.

## 2. Planned changes

### 2.1 Signature: the urna's digit boxes (`components/urna-number.tsx`, new)

`<UrnaNumber n="22" party="PL" size="lg|md|sm" />`: one box per digit, Atkinson Hyperlegible
Mono, the boxes' border in the party colour (text stays `--ink`, so contrast never depends
on the party colour), 2 px gap, the radius of the urna's screen fields (2 px). It replaces:
- the headline's initials ring (`candidate-mark.tsx`, deleted): `lg`, 2 boxes of 2.25 rem;
- the dots in `LeaderCell`, the governor closest races, the senate closest races and the
  most-voted list: `sm` boxes, so a row reads "[2][2] Douglas Ruas PL 49,27%";
- the governor tiles keep the UF sigla as the label and gain the leader's number in `sm`.
Accessible name: the boxes are `aria-hidden`; the number is already written in text next
to each (as today: "PL 22"), so nothing new is read twice.

### 2.2 CONFIRMA: the TSE's "Eleito" as the urna's green key

Where the TSE's `situation` is "Eleito" (or "Eleito por QP/média"), a small key-shaped badge
"ELEITO" in `--confirma` with the key's rounded-rectangle shape and a 1 px inset shadow,
instead of the plain text. Only for the TSE's own flag, never for our inference (a leader at
100% counted stays "lidera"). The colour stays reserved for this (identity §2.5).

### 2.3 One motion: what changed

On a new `seq`, a digit string that changed (a TSE % or a vote count) gets a 1.2 s
`--wash` background that fades out; nothing moves, nothing counts up. Off under
`prefers-reduced-motion`. It tells a reader on election night which numbers the last
update touched, which today they cannot see.

### 2.4 Alternatives considered and rejected

- **The boletim de urna as a receipt strip** (thermal paper, dashed rules, QR): the most
  photogenic artifact, but it would be a costume on the headline; the BU's real role (the
  source of the timelines) waits for `TASK-bu-timelines.md`.
- **LCD/seven-segment digits:** the urna's screen isn't segmented, and segment digits
  confuse 1/7 and 6/8 for exactly the readers Atkinson was chosen for.
- **Count-up animations:** they show numbers that the TSE never published, for a moment.
- **A new palette or display face:** the current ones were chosen and AA-checked for this
  audience (identity §2.2); changing them now adds risk for no gain in meaning.

## 3. Why

Photos are blocked (`[VERIFY: TSE candidate photo URLs and their license]`), and initials are
the template answer to that. The number is better than a photo here: it's what the voter
typed, it's in every TSE file, it carries the party (its first two digits) and it reads the
same on a 375 px phone. Cost: ~half a day; no data or contract change.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/web/src/components/urna-number.tsx` | new | the digit boxes |
| `apps/web/src/components/confirma.tsx` | new | the "ELEITO" key |
| `apps/web/src/components/candidate-mark.tsx` | delete | replaced |
| `apps/web/src/components/headline.tsx`, `leader-cell.tsx`, `legislative-highlights.tsx`, `governors/governor-summary.tsx`, `uf-race.tsx` | edit | use both |
| `apps/web/src/hooks/use-changed.ts` | new | which strings changed since the previous seq |
| `apps/web/src/app/globals.css` | edit | the key's shadow, the change highlight, reduced motion |
| `apps/web/e2e/*.spec.ts` | edit | the assertions below |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green; unit test: `UrnaNumber` renders as
   many boxes as digits for "22", "131", "2222", "22222".
2. e2e: the headline shows boxes "2","2" and "1","3"; RJ's governor race shows "Situação no
   TSE: 2º turno" and no ELEITO key; Bahia's shows one ELEITO key; axe zero violations,
   light and dark, 375 and 1440 px.
3. Screenshots of every office, both themes, both widths, critiqued in §6.

## 6. Outcome (2026-10-09, built and verified locally; deploy pending, run by the user)

- Web unit tests 49/49 (new: the digit boxes for 2–5 digits); e2e 38/38 against the live
  bucket, including the urna checks (headline boxes 2,2 / 1,3; no ELEITO key in RJ's runoff;
  one in Bahia) and axe with zero violations in both themes at 375 and 1440 px.
- `initials()` and `candidate-mark.tsx` removed (no other user). The change highlight lives
  in `components/changed.tsx` + `hooks/use-changed.ts` (the plan said only the hook).
- **Screenshot critique:** the headline now opens on "[2][2] … [1][3]", the one thing on the
  page only a Brazilian ballot has; the governor tiles read as a wall of urna screens; the
  ELEITO key is the only green on any page, and only where the TSE says so. Fixed during the
  pass: the key stretched to the column's width in the headline (now `w-fit`), and senate
  rows wrapped to three lines (the key moved next to the %, "não eleito" is screen-reader
  text, since the row order already says who stayed out).
- Not visible in screenshots (the archive doesn't change): the change highlight; it's
  exercised on the 10-15 replay at ×20 and the 10-22 rehearsal.
