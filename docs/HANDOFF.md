# Handoff prompt: architecture plan

Paste the prompt below into a new Claude Code session opened in this folder
(`~/Documents/personal/apuracao-2026`).

---

You are acting as a senior software architect with deep experience in distributed,
data-heavy and high-traffic live systems. Your job in this session is to produce
**`docs/architecture.md`**: a complete, well-defined architecture plan for this project. Do
**not** write application code in this session.

**Read first, in this order:** `CLAUDE.md` (workflow rules and invariants, which are
binding), `docs/research/01-tse-results-feed.md` (verified facts about the TSE feed), and the
real captured files in `docs/research/samples/`. Treat the research doc as verified as of
2026-10-07, but re-check anything time-sensitive. In particular, check whether the 2nd-round
files (`ele2026/6258`, `ele2026/6260`) and the simulated environment
(`resultados-sim.tse.jus.br`) are reachable yet.

**The product:** a live dashboard for the Brazilian election count, in the style of
seuimposto.com's "Apuração 2026". It has a national headline (who leads, %, votes, gap), a
municipality-level choropleth map of Brazil, per-region/UF breakdowns, turnout and
blank/null figures, an "over the count" line chart, a **timeline scrubber that replays the
count**, and a feed of notable updates. The hard deadline is the **2nd round on Sunday
2026-10-25**: president nationwide plus governor in AC, AM, DF, ES, RJ, RN and TO.

**The challenges the architecture must answer, each with numbers:**

1. **Ingestion against a rate-limited CDN.** TSE files sit behind Akamai with `max-age≈60s`,
   ETag/304 support and `x-ratelimit-limit: 2000;w=1`. Design the poll loop: the two-tier
   strategy (coverage `-ab` files → diff per-municipality `ht`/`st` → conditional fetch of
   only the changed `-u` files), the request budget per cycle, intervals, backoff, and what
   happens when the TSE is slow, returns errors, or serves an older `idg` than one we
   already saw (out-of-order or regressing versions).
2. **History and replay.** The TSE only serves the latest version, so we must record every
   version ourselves. Design the immutable raw-snapshot log (storage, keys, dedup by
   content), and the projections derived from it (current state, per-moment timeline,
   "updates" feed). Show how a projection is rebuilt from scratch, and how long that takes.
3. **Fan-out on election night.** Assume a stated, justified peak of concurrent viewers.
   Design how updates reach browsers without readers ever touching ingestion. My leading
   hypothesis, which you should challenge: publish **immutable, versioned JSON views**
   (`/v/{seq}/…`) to object storage/CDN with long cache lifetimes, plus a tiny "latest seq"
   pointer (short TTL, or SSE). Then the CDN absorbs the load, and replay is just loading
   an older `seq`.
4. **Correctness and trust.** Parsing string numbers with Brazilian decimals; missing vs zero
   vs failed; verifying the TSE's JWS signatures if feasible; reconciling our sums against
   the TSE's own totals; idempotency.
5. **The map.** IBGE municipal boundaries (join on `cdi` from the municipality index),
   simplification to TopoJSON, payload size, and rendering 5,757 polygons smoothly
   (SVG vs canvas/WebGL), with an accessible table alternative.
6. **Operating it.** Hosting and its cost, deployment, observability (ingestion lag, last
   successful fetch per file, error rates), alerting on election night, and a runbook.
   Also: how we test it **before** the 25th without the live feed, using a replay harness
   over real captured 1st-round files at accelerated speed, plus a load test.
7. **After the count (stretch).** Bulk ingestion of per-section ballot-box data
   (`arquivo-urna`, dadosabertos) for analysis. Design the seam only. It is not in scope
   for the 25th.

**Principles:** elegant and simple beats impressive. This is also a learning project in
distributed systems, so be explicit about the tension. For every component (a message
broker, a stream processor, a separate database) state whether the stated numbers actually
require it. If something is added mainly for learning value, label it as such and keep it
off the election-night critical path. Prefer the boring option that survives a traffic
spike unattended.

**Process:**

- Verify every library, host and API detail against current official docs (CLAUDE.md §2.0)
  and link the source. Use `[VERIFY: …]` for anything you can't confirm. Capture any new
  real TSE response into `docs/research/samples/` and record the fact in `docs/research/`.
- `docs/architecture.md` must contain: goals and non-goals; the stated capacity numbers;
  a component diagram; the data flow from TSE to browser; storage layout and key schemes;
  the contracts (`packages/contracts`); failure modes and how each degrades; the
  testing/replay/load strategy; hosting and cost; an ADR-style "decisions and rejected
  alternatives" section; and the open questions for the user.
- Then write **`docs/tasks/TASK-implementation-plan.md`**: a phased build order working
  back from 2026-10-25, with a must-have cut (live president map plus recording) clearly
  separated from nice-to-haves, and dates per phase.
- Ask me the decisions that are genuinely mine (hosting budget, domain, whether to show
  ads/analytics, how much to trade simplicity for learning) using concise multiple-choice
  questions. Don't guess these.
- When done, update `CLAUDE.md`'s stack table and `README.md`'s status to match, then commit
  (no `Co-Authored-By` trailer).
