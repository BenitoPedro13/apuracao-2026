# TASK: Contracts and TSE parsing (Phase 0, part 2)

**Status (2026-10-07): done.** Outcome and deviations are in §6.

Phase 0 of `TASK-implementation-plan.md`, must be done by **Thu 2026-10-08**. Part 1 was
`TASK-scaffold-monorepo.md` (done).

## 1. Current scenario

`packages/contracts` and `packages/tse` exist as empty shells with one smoke test each. What
we know about the TSE files is in research 01/02 and in `docs/research/samples/`: 9 `.json`
files, 2 `.jws` files, the TSE's prod JWK and one header capture. All are 1st-round
(`6257`/`6259`), frozen at final state.

Observed shapes (read from the samples on 2026-10-07; nothing here is from memory):

- **`-u` result files** (`br`, `uf`, `mu`, `zz` levels; president and governor share the
  shape). Header fields: `ele t f sup tpabr cdabr dg hg idg dt ht dv tf and esae mnae`.
  Then `carg[] → agr[] (n nm tp com) → par[] (n sg nm nfed tvtn tvan) → cand[] (n sqcand nm
  nmu dt dvt seq e st vap pvap pvapn vs[])` plus `carg[].fed[]`, and the blocks `s`
  (sections), `e` (electorate/turnout) and `v` (votes). `tpabr` is `br | uf | mu`. The abroad file is
  `tpabr: "uf"`, `cdabr: "zz"` (checked in the `zz` sample), so "abroad" is identified by
  `cdabr`, not by `tpabr`. On the national file,
  `cand.st` is `"2º turno" | "Não eleito"` and `cand.e` is `"s" | "n"`.
- **`-ab` coverage files.** Header: `ele t f dg hg idg`, then `abr[]`. The `br` file has 29
  rows (`tpabr: uf | br`) carrying `munf munpt munnr` (+ their `p…` percentages). A UF file
  (SP) has 646 rows (`tpabr: mun | uf`) with `and tpabr cdabr dt ht s e`. Coverage rows
  have **no `v` block** and no candidate votes.
- **`-cm` municipality index.** `dg hg idg f`, then `abr[] (cd ds mu[] (cd cdi nm c z[]))`:
  5,757 municipalities, 5,571 with a non-empty `cdi`, 27 with `c: "s"`.
- **`ele-c` catalog.** `dg hg f idg arq[] (tp dir) pl[] (cd cdpr c dt dtlim e[] (cd cdt2
  sqele nm t tp abr[] (cd cp[] (cd ds tp))))`.
- **Every number is a string**: integers (`"56104503"`), pt-BR decimals (`"47,03"`) and
  high-precision decimals (`"47,027772356"`). Dates are `dd/mm/yyyy`, times `hh:mm:ss`
  (Brasília).
- **`.jws`**: compact JWS, header `{"kid":"sNbt9Q_fLS65zE1_ZLNV-XRRwPY","typ":"JOSE",
  "alg":"EdDSA"}`, an Ed25519 signature, and a payload byte-identical to the `.json`
  (research 02 §2, verified with WebCrypto for 4 files, but only 2 `.jws` were saved).

What's missing: no code can parse, validate or verify any of this. Phase 1 (the recorder)
needs URL builders, `.jws` verification and the `Observation` contract on day one.

## 2. Planned changes

### 2.1 Samples: capture the missing `.jws` siblings (one-off, polite)

`scripts/capture-samples.ts`, run once by hand. For each `.json` in `samples/` without a
`.jws` sibling (7 files: `ele-c`, `mun-e006257-cm`, `br-e006257-ab`, `sp-e006257-ab`,
`sp71072-c0001-…-u`, `zz-c0001-…-u`, `rj-c0003-e006259-u`), it does one plain GET of the
`.jws` URL, sequentially, with 1 s between requests, no query string (research 02 §3) and a
`User-Agent` naming the project. That's 7 requests in total.

- It saves the files as `samples/<same name>.jws`. **It never overwrites an existing
  sample.**
- It records whether each `.jws` payload is byte-identical to the saved `.json`. These are
  frozen 1st-round files, so they should be identical. If one isn't (the TSE regenerated
  it), the script also saves the fresh `.json` as `<name>.<idg>.json`, and research 02 gets
  a line about it.

### 2.2 `packages/contracts` (Zod 4)

- **Primitives** (`src/tse/primitives.ts`): `TseInt` (`/^\d+$/` → `number`, ≤
  `MAX_SAFE_INTEGER`), `TseDecimal` (`/^\d+(,\d+)?$/` → `{ raw: string, value: number }`;
  `raw` is what gets displayed, ADR-12), `TseDate` (`dd/mm/yyyy`), `TseTime` (`hh:mm:ss`),
  and `tseInstant(date, time)` → ISO 8601 with `-03:00`. Also `TseFlag` (`"s" | "n"`).
- **Input file schemas** (`src/tse/files.ts`): `TseResultFile`, `TseCoverageFile`,
  `TseMunicipalityIndex`, `TseElectionCatalog`, with the fields in §1.
  - Every field we read is typed strictly. Each object is a **loose object**: unknown keys
    are kept and don't fail validation, so a field the TSE adds on the night doesn't take
    the pipeline down. The raw blob is stored regardless (`architecture.md` §7.1).
  - Fields we don't read yet (the `p…n` high-precision decimals, `vs[]`, `fed[]`) are
    typed only as far as the samples show, and are left optional.
- **`Observation`** (`src/observation.ts`): exactly as `architecture.md` §8. This is the
  recorder ↔ projector contract, so it's needed in Phase 1.
- **`ResultStatus`** (`src/status.ts`): the five-state enum of §7.2 (`not_published`,
  `no_sections`, `counting`, `final`, `fetch_failed`), with numeric codes for `MapView`.
  Deriving a status from a file belongs to `packages/views` (Phase 2).
- **Not in this task:** the published view schemas (`LatestPointer`, `Manifest`,
  `NationalView`, …). They are designed together with the fold in
  `TASK-projector-and-views.md`.

### 2.3 `packages/tse`

- **Codes** (`src/codes.ts`): elections `6257`/`6258` (federal, 1st/2nd round),
  `6259`/`6260` (state); offices `c0001` (president), `c0003` (governor); the 27 UFs plus
  `br` and `zz`; the 7 governor UFs of the 2nd round. All are from research 01 §3 / §1.
- **URL/path builders** (`src/paths.ts`): `resultPath`, `coveragePath`,
  `municipalityIndexPath`, `catalogPath`, each returning the path relative to
  `https://resultados.tse.jus.br/oficial/`, with `.jws` by default (`.json` on request).
  Plus the inverse `parsePath(path)` → `{ election, fileType, scope }` (the identity used by
  `Observation`), which rejects any path it can't classify.
  `[VERIFY: 2nd-round files use the same naming. Re-check from 10-20, research 01 §3]`.
- **`.jws` verification** (`src/jws.ts`): `verifyJws(text, keys)` →
  `{ status: 'valid', kid, payload: Uint8Array } | { status: 'invalid' | 'unknown_kid' |
  'malformed', reason }`.
  - It uses **WebCrypto Ed25519** (`crypto.subtle`), which Node 24 and browsers both have,
    so "verify this number" can reuse it in the web app.
  - It requires `alg: "EdDSA"` and a `kid` that is among the given keys. It checks the
    signature over `header.payload` bytes, as research 02 §2 ran it.
  - Handling an unknown `kid` (fetch the JWK, page a human) is the recorder's job, not
    this function's.
- **Pinned key** `packages/tse/keys/prod.jwk.json`: a copy of
  `samples/app_assets_assinatura-jws_prod.jwk.json`. A test asserts the two are identical.
- **`parseTseFile(path, bytes)`**: picks the schema from `parsePath` and returns
  `{ ok: true, data } | { ok: false, issues }`. It never throws on bad input.

### 2.4 Alternatives considered and rejected

- *`jose` for JWS* (what the TSE app uses): rejected for now. Compact Ed25519
  verification is ~30 lines on WebCrypto and needs no dependency in either runtime. If
  JWS needs grow (JWK sets, `crit` headers), switch to `jose` then.
- *Strict objects (reject unknown keys):* rejected. An extra field on election night would
  fail every file. Unknown keys are kept, and a later metric can count them.
- *Hand-built fixtures for edge cases:* rejected (CLAUDE.md, "Tests"). Negative cases are
  derived from the real files (a flipped byte, a swapped `kid`, a truncated token), never
  written from scratch.
- *Published view schemas now:* rejected. They'd be guessed before the fold that produces
  them exists.

## 3. Why

The recorder (gate 10-11) can't fetch, verify or describe a file without the path builders,
`verifyJws` and `Observation`, and it can't store "schema ok/failed" without the input
schemas. Every later phase reads TSE data through these two packages, so a mistake in
string-number parsing would show up on every screen. Cost: about one day, and 7 GETs to the
TSE.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/capture-samples.ts` (+ `scripts/package.json`) | new | one-off, 7 sequential GETs, never overwrites |
| `docs/research/samples/*.jws` | new | 7 `.jws` siblings |
| `docs/research/02-signatures-cache-and-map-mesh.md` | edit | capture date; payload == `.json` result per file |
| `packages/contracts/src/tse/{primitives,files}.ts` | new | |
| `packages/contracts/src/{observation,status,index}.ts` | new/edit | |
| `packages/contracts/src/**/*.test.ts` | new | |
| `packages/contracts/package.json` | edit | `zod` 4.x (newest that passes pnpm's release-age policy) |
| `packages/tse/src/{codes,paths,jws,parse,index}.ts` | new/edit | |
| `packages/tse/keys/prod.jwk.json` | new | pinned TSE key |
| `packages/tse/src/**/*.test.ts` | new | |
| `docs/architecture.md` | edit | resolve or narrow any `[VERIFY]` the samples answer; §8 `scope.level: 'zz'` comes from `cdabr` |
| `docs/tasks/TASK-implementation-plan.md` | edit | Phase 0 check: "every captured `.jws`" (9), not "all four" |
| `README.md`, `CLAUDE.md` | edit | status |

## 5. Verification

`pnpm turbo run lint check-types test build` exits 0, with these tests, all reading the real
files in `docs/research/samples/`:

1. **Signatures:** all 9 `.jws` return `valid` with the pinned key, and each payload equals
   its `.json` byte for byte (or the documented `<idg>` variant).
   - Flipping one byte in the payload segment → `invalid`.
   - Flipping one byte in the signature → `invalid`.
   - The same token re-headed with another `kid` → `unknown_kid`.
   - `alg` changed → `malformed`.
   - A token truncated to 2 segments → `malformed`.
   - The pinned key equals the captured JWK.
2. **Schemas:** each of the 9 `.json` parses with the schema `parseTseFile` selects
   (`ok: true`).
   - A copy with one integer replaced by `"1.000"` → `ok: false`, and the issue names the
     field.
3. **Numbers match research 01 §4** (from the national file):
   - Flávio Bolsonaro `vap` = 56,104,503 and `pvap.raw` = `"47,03"`; Lula `vap` =
     53,879,538.
   - `vv` = 119,300,788; `pc.raw` = `"78,92"`.
   - Σ `cand.vap` = `vv`, and `tv` = `vv + vb + tvn` (125,275,835).
   - The same two identities hold for the SP-municipality, `zz` and RJ-governor files.
4. **Municipality index:** 5,757 municipalities; 5,571 distinct non-empty `cdi`; 27
   capitals.
5. **Coverage:** `br-…-ab` has 29 rows; `sp-…-ab` has 646 (645 `mun` + 1 `uf`).
6. **Paths:** for every (UF, municipality) in the `-cm` index × {`6257`, `6258`},
   `parsePath(resultPath(…))` round-trips (5,757 × 2 = 11,514 paths). The 7 sample file
   names map to their real URLs. `parsePath` rejects `"…/br-c0001-e006257-u.json?nocache=1"`
   and unknown shapes.
7. **Time:** `tseInstant("05/10/2026","12:51:05")` = `"2026-10-05T12:51:05-03:00"`.
8. **Politeness:** the capture script made exactly 7 requests, verified from its own log line.

## 6. Outcome and deviations (2026-10-07)

`pnpm turbo run lint check-types test build`: 28/28 tasks pass. `contracts` has 32 tests and
`tse` has 52, all reading `docs/research/samples/`. Test inputs include
`$TURBO_ROOT$/docs/research/samples/**`, so a changed sample re-runs the tests (checked).

- **Capture:** 7 requests, all 200. All 7 payloads are byte-identical to the saved `.json`,
  so no `<idg>` variants were needed. The script runs with plain `node` (Node 24 strips
  types), so there's no `scripts/package.json`. The root `package.json` is now
  `"type": "module"`.
- **Finding: sub judice votes** (research 02 §8). The planned identity
  `vv = Σ candidates`, `tv = vv + vb + tvn` fails on the RJ governor file. The verified ones
  are `vvc = vv + van + vansj`, Σ candidates = `vvc`, Σ valid candidates = `vv`,
  `tv = vvc + vb + tvn`, `tvn = vn + vnt`. The TSE's `pvap` is over `vvc`. The tests assert
  these identities on all 4 result samples, and `architecture.md` §7.1/§7.4 are corrected.
- **`Observation.election` and `.scope` are optional** (architecture.md §8 updated). The
  catalog has no election, and the index and the catalog have no scope.
- **Coverage-row `dt`/`ht` accept `""` → `null`**, defensively, with a `[VERIFY]` on the
  first 2nd-round `-ab` files. Every 1st-round row is final and filled, so the samples
  can't show the not-started case.
- **Result-file `cand.pvap` stays strict.** If a not-yet-counted candidate has `""` on the
  night, the file fails its schema: the raw blob is kept and we get paged
  (`architecture.md` §7.1). The first 2nd-round files, published before counting starts,
  will show which case applies.

