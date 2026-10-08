# Research 02 — Signatures, CDN behaviour, test environments and the map mesh (verified 2026-10-07)

Addendum to `01-tse-results-feed.md`, written while drafting `docs/architecture.md`. Everything
marked **verified** was observed directly on 2026-10-07 (≈ 12:57–13:10 UTC) with `curl`,
`node` (WebCrypto) and `mapshaper`. New captured files are in `samples/`.

## 1. Re-checks of time-sensitive facts

| Check | Result (2026-10-07) |
|---|---|
| 2nd-round files `ele2026/6258/…` (`config/mun-e006258-cm.json`, `dados/br/br-c0001-e006258-u.json`, `dados/br/br-e006258-ab.json`) | **404** (248-byte error body) |
| 2nd-round files `ele2026/6260/…` (`config/mun-e006260-cm.json`, `dados/rj/rj-c0003-e006260-u.json`, `dados/rj/rj-e006260-ab.json`) | **404** |
| `resultados-sim.tse.jus.br` | **DNS does not resolve** (connection fails, status `000`) |
| `resultados-hmg.tse.jus.br` (homologation host named in the official app's config) | resolves to **`127.0.0.1`**: internal only, unusable |
| `resultados.tse.jus.br/simulado2026/comum/config/ele-c.json` | **503** |
| Internet Archive CDX for the 1st-round result URLs | **429 Too Many Requests** from `web.archive.org`; still `[VERIFY: retry later; would give a few real intermediate 1st-round versions]` |

Consequence: **there is no TSE-hosted test environment we can rely on before the 25th.** The
replay harness in `docs/architecture.md` §9 is the test bed.

## 2. Every `.json` has a signed `.jws` sibling (verified)

The official results app (`/oficial/app/`, Angular, build `26.10.9 (6dc83f1)`) does **not**
fetch `*.json`. With `assinaturaJwsAtiva: true` (its production setting) it rewrites every
path ending in `.json` to `.jws`, fetches that as text, and verifies it with
[`jose`](https://github.com/panva/jose) before using the payload (functions
`caminhoParaJws` / `verificarEExtrairPayload` in lazy chunk `9132.c7aa7f9416065cdd.js`).

- **Format:** JWS compact serialization, protected header
  `{"kid":"sNbt9Q_fLS65zE1_ZLNV-XRRwPY","typ":"JOSE","alg":"EdDSA"}`, embedded payload.
- **Key:** Ed25519 public key, inlined in `main.js` and also served at
  `/oficial/app/assets/assinatura-jws/prod.jwk.json` (captured as
  `samples/app_assets_assinatura-jws_prod.jwk.json`):
  `{"kty":"OKP","crv":"Ed25519","x":"kWlpNHjuws1csyQZwzn3Fhzbi3RD435RbpThtSr4hMc","kid":"sNbt9Q_fLS65zE1_ZLNV-XRRwPY"}`.
  The app has other key ids per environment (`hmg`, `dsv`, `tst`, `simulado`); only `prod`
  matters to us.
- **Verified with Node's WebCrypto (`crypto.subtle.verify({name:"Ed25519"}, …)`):** the
  signature is **valid** for `br-c0001-e006257-u.jws`, `br-e006257-ab.jws`,
  `comum/config/ele-c.jws` and `config/mun-e006257-cm.jws`, and in all four the decoded
  payload is **byte-identical** to the corresponding `.json`.
- **2026-10-07 23:5x BRT:** the `.jws` siblings of the other 7 saved `.json` samples were
  captured (`scripts/capture-samples.ts`, 7 sequential GETs). All 7 payloads are
  byte-identical to the saved `.json`, and all 9 `.jws` in `samples/` verify with the pinned
  key (`packages/tse` tests).
- Also present for municipal and governor files: `sp/sp71072-c0001-e006257-u.jws`,
  `rj/rj60011-c0003-e006259-u.jws`, `rj/rj-e006259-ab.jws` all 200.
- Size cost: base64url adds ~35% (`br-c0001` 9,349 B → 12,640 B raw; ~3.8 KB gzipped on the
  wire vs ~2.4 KB for the `.json`).

Verification snippet (what was run; to be turned into `packages/tse` code under a task doc):

```js
const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
const [h, p, s] = jws.trim().split('.');
const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key,
  Buffer.from(s, 'base64url'), Buffer.from(`${h}.${p}`));
const payload = Buffer.from(p, 'base64url'); // == the .json bytes
```

**Implication:** fetch the `.jws` instead of the `.json`. One request gives the data *and*
a proof that the TSE published it. `[VERIFY on 2026-10-25: .jws and .json are regenerated
together (sample 10 pairs every 5 min during the count)]`.

## 3. CDN behaviour, sharpened (verified)

- **`ETag` is the MD5 of the uncompressed body.** For `br-c0001-e006257-u.json`,
  `etag: "2da19dbacd44746287f057d454ed01f0"` equals `md5` of the identity-encoded body; the
  gzip-encoded body hashes differently. So the ETag doubles as a transfer-integrity check.
- **`If-None-Match` → 304 and `If-Modified-Since` → 304** both work (0-byte body).
- **`cache-control: max-age` counts down** (`max-age=53, 52, 51 …` on consecutive requests,
  with a fixed `expires`). The edge object expires at a fixed instant, so the best time to
  re-poll a file is just after its `Expires`, not on a fixed 60 s clock.
- **`x-ratelimit-remaining` did not decrease with our requests** (it stayed at 1,927 across
  five consecutive requests, and differed between edge responses). Together with
  `x-amz-request-id: tx…-default` (Ceph RadosGW format), this indicates the
  `x-ratelimit-*` headers are **the origin's limit towards Akamai, cached with the object**,
  not a per-client budget. The real per-client limit at Akamai is unknown, so our own
  ceiling must be conservative and adaptive (see `architecture.md` §4.3).
- The official app appends `?nocache=<ms timestamp>` to every request. Two such requests
  both returned `cdn-cache-status: Miss from child`, so a query string probably bypasses the
  edge cache. **We must not do this**: it loads the TSE origin and violates invariant 4.
- `cdn-cache-status` values seen: `Miss from child`, `Miss from child, Hit from parent`,
  `RefreshHit from child` (Akamai tiered caching).
- Response headers of the national file: `samples/headers_br-c0001-e006257-u.json.txt`.

## 4. Coverage files, more precisely (verified)

- `zz/zz-e006257-ab.json` exists (200), so coverage polling is **br + 27 UFs + zz = 29
  files** per election.
- `br-e006257-ab.json` has 29 rows (`ac` … `to`, `zz`, `br`).
- 2nd round, per cycle: 29 coverage files for president (`6258`) + 7 for governor (`6260`) =
  **36**, plus the aggregate result files: br + 27 UFs + zz for president = 29, and 7 UF
  files for governor = **36**. Tier 1 = **72 conditional requests**.
- Municipal result files: **5,757** for president (5,571 in Brazil + 186 abroad) and **561**
  for governor (AC 22 + AM 62 + DF 1 + ES 78 + RJ 92 + RN 167 + TO 139). Tier 2 maximum =
  **6,318 files**.
- Gzip ratios: SP coverage 537,414 B → 43,339 B (12.4×); municipal result 9,376 B → 2,455 B
  (3.8×).

## 5. Municipality index details (verified, `mun-e006257-cm.json`)

- 28 groups; **5,757** municipalities: **5,571 in Brazil**, 186 abroad (`zz`, `cdi` empty).
- `c: "s"` marks the **27 capitals** (`c: "n"` otherwise).
- 6,292 (municipality, zone) pairs in total.
- All 5,571 domestic `cdi` values are distinct and non-empty.

## 6. IBGE municipal mesh (verified)

- Latest: **Malha Municipal 2025**,
  `https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip`
  (237 MB zip; 320 MB `.shp`; SIRGAS 2000 lon/lat; files dated 2026-02-20). 2024 is also
  available (208 MB).
- **5,573 features**: the 5,571 TSE municipalities **plus two "Áreas Operacionais"** of lake
  water in RS (`4300001` Lagoa Mirim, `4300002` Lagoa dos Patos), which have no voters.
- **Join on `CD_MUN` = TSE `cdi`: 5,571 / 5,571 match, zero orphans on the TSE side.** The two
  lake features are drawn as water/neutral or dropped.
- TopoJSON sizes for the 5,571 municipalities after `mapshaper -simplify <p> weighted
  keep-shapes` (mapshaper 0.7.80), every feature kept:

  | Simplification | Quantization | Raw | gzip -9 |
  |---|---|---|---|
  | 3% (lagoas kept) | 1e5 | 3.54 MB | 1,018 KB |
  | 1.5% (lagoas kept) | 1e5 | 2.29 MB | 700 KB |
  | 0.8% | 2e4 | 1.57 MB | 435 KB |
  | 0.4% | 2e4 | 1.26 MB | 357 KB |
  | 0.4% | 1e4 | 1.21 MB | **330 KB** |
  | 0.2% | 1e4 | 1.06 MB | 291 KB |

  `[VERIFY: visual check at 0.4%/1e4 at national zoom and when zoomed into a UF — small
  municipalities in SP/MG must stay legible]`.

## 7. Hosting facts used by the architecture (verified against official pages)

| Fact | Source |
|---|---|
| Amazon MSK, São Paulo: `kafka.t3.small` **$0.0736/broker-hour**; `kafka.m7g.large` $0.3253; storage $0.19/GB-month; MSK Serverless **$1.195/cluster-hour** + $0.0024/partition-hour | AWS Price List API, `AmazonMSK/current/sa-east-1/index.json` |
| AWS Fargate, São Paulo, ARM: **$0.0557/vCPU-hour, $0.00612/GB-hour** | AWS Price List API, `AmazonECS/current/sa-east-1/index.json` |
| CloudFront pay-as-you-go, South America: **$0.110/GB**, **$0.0220 per 10,000 HTTPS requests**; always-free **1 TB** and **10 M requests**/month | [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| CloudFront flat-rate plans: Free $0 (100 GB, 1 M req), **Pro $15 (50 TB, 10 M req)**, Business $200 (50 TB, 125 M req); "no overage charges"; first spike up to 3× the allowance doesn't affect service; sustained excess may degrade delivery | [Flat-rate plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html) |
| CloudFront honours `stale-while-revalidate` and `stale-if-error` | [Expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html) |
| S3 `PutObject` with `If-None-Match: *` → `412 Precondition Failed` if the key exists; first concurrent writer wins | [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) |
| Cloudflare R2 public `r2.dev` is "rate-limited and should only be used for development"; custom domains need a Cloudflare zone | [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) |
| Vercel Hobby is "restricted to non-commercial personal use only"; 100 GB Fast Data Transfer | [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines) |
| Library versions on npm (2026-10-07): `next` 16.4.0, `zod` 4.6.5, `@confluentinc/kafka-javascript` 1.10.1 (updated 2026-09-10), `kafkajs` 2.2.4 (**last published 2023-02**), `@aws-sdk/client-s3` 3.1147.0, `jose` 6.2.12, `mapshaper` 0.7.80, `topojson-client` 3.1.0, `d3-geo` 3.1.1 | `npm view` |

## 8. Vote totals and sub judice candidacies (verified 2026-10-07, from the samples)

Found while testing `packages/contracts` against the RJ governor file
(`samples/ele2026_6259_dados_rj_rj-c0003-e006259-u.json`). Garotinho has
`dvt: "Anulado sub judice"` and 274,411 votes. Those votes are **not** in `vv`.

| Identity | RJ governor | National president |
|---|---|---|
| `vvc = vv + van + vansj` | 8,669,038 = 8,394,627 + 0 + 274,411 | 119,300,788 = 119,300,788 + 0 + 0 |
| Σ all `cand.vap` = `vvc` | 8,669,038 | 119,300,788 |
| Σ `cand.vap` with `dvt = "Válido"` = `vv` | 8,394,627 | 119,300,788 |
| `tv = vvc + vb + tvn` | 9,845,867 | 125,275,835 |
| `tvn = vn + vnt` | 675,292 | 3,674,249 |

- **`pvap` is computed over `vvc`, not `vv`:** Douglas Ruas has 4,271,199 / 8,669,038 =
  49.27% (the file says `"49,27"`). Over `vv` it would be 50.88%.
- Consequence: any percentage we compute ourselves uses `vvc` as its denominator, and the
  reconciliation identities are the ones above, not `vv = Σ candidates`
  (`architecture.md` §7.1, §7.4).
- `[VERIFY: meaning of van ("anulado", 0 in every sample) and vnt; the TSE's EA spec PDFs,
  research 01 §6]`

## 9. The full 1st-round capture (verified 2026-10-08, by the recorder on AWS)

The recorder's first run (03:26–03:47 UTC, 10 req/s, from Fargate in sa-east-1) fetched
every 1st-round file for president (`6257`) and governor (`6259` `c0003`):

| Group | Files |
|---|---|
| catalog + 2 municipality indexes | 3 |
| president: coverage + aggregate, br + 27 UFs + zz | 29 + 29 |
| governor: coverage + aggregate, 27 UFs | 27 + 27 |
| president municipal, incl. 186 abroad | 5,757 |
| governor municipal | 5,571 |
| **total** | **11,443**, all 200, all with a valid `prod` signature |

- No 429/503 at 10 req/s from one IP; the AIMD rate never dropped.
- Before failure logging was added, ~3% of municipal requests failed once and succeeded on
  retry (cause not captured). After the redeploy with logging, 0 failures in the next
  10+ minutes. `[VERIFY: watch the "fetch failed" log during the soak; is it Akamai
  connection resets on the first burst?]`
- **Files with no votes have empty timestamps and no `dvt`.** 41 abroad cities had their only
  section not installed (`s.sni = "1"`, all votes `"0"`). Their `-u` files have
  `"dt": "", "ht": ""` and candidates without the `dvt` key
  (`samples/ele2026_6257_dados_zz_zz29424-c0001-e006257-u.json`). The contract now accepts
  both. Not-yet-counted municipalities on election night probably look the same.
- **A municipal file's `dt/ht` isn't always its coverage row's.** `sp71072` (São Paulo):
  its row in `sp-e006257-ab` says 04/10/2026 21:50:33, but the final `-u` file says
  `dt/ht` 05/10/2026 12:51:05 and `hg` 12:52:35, the instant of the br re-totalization
  (`br-c0001-e006257-u` has the same `dt/ht`). So the final files were regenerated after
  the count, and only the coverage row keeps the original totalization instant. The
  recorder's tier-2 check (`tseTotalizedAt ≥` the row instant) still accepts it; fake-tse
  reveals municipal files at the row instant.
  **On the full export (2026-10-08): 11,287 of the 11,328 municipal files with a `dt/ht`
  differ from their row.** 11,051 are later (almost all 05/10 12:51:05, the re-totalization).
  **236 are earlier, all governor (`6259`): PE 185, AM 51.** Their coverage rows were
  re-stamped 5 min to ~43 h after the file's `dt/ht` (the last at 06/10 17:57:45 BRT, PE)
  with no newer `-u` file. If that happens on the night, the recorder's tier-2 check sees the
  file as older than its trigger, retries `PENDING_MAX_TRIES` (5) times and then counts it
  in `tse_stuck_mun` and stops. The version it fetched is still stored, so nothing is lost,
  but a later real update to that file would only be fetched on the next coverage change.
  `[VERIFY: on the night, whether row re-stamps without a new -u happen during the count]`
- **The earliest coverage row instant is 16:16:53 BRT on 04/10**, before the 17:00 close in
  Brasília (25 instants before 17:00; presumably abroad sections in earlier time zones
  `[VERIFY: which rows]`). fake-tse reveals them at the replay start.
- **Two exact ties for president in the 1st round:** Crixás do Tocantins (TO 73555), 679 ×
  679, and Trabiju (SP 62448), 574 × 574, Lula × Flávio Bolsonaro.
- The 41 observations recorded before the fix say `schema: "failed"`. The log is immutable,
  so they stay; projections re-validate blobs with the current schema.

