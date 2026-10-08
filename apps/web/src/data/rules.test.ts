import { describe, expect, it } from "vitest";
import { EpochsIndex, ResultView } from "@apuracao/contracts";
import { pointer, realView } from "../../test/real";
import type { PointerSnapshot } from "./queries";
import { AMBER_AFTER_MS, byVotes, difference, freshness, hasNumbers, RED_AFTER_MS, resolveRounds } from "./rules";

const br = ResultView.parse(realView("result/president/br"));

describe("headline rules on the real 1st-round national view", () => {
  it("orders the leaders by votes: Flávio Bolsonaro, then Lula", () => {
    const [first, second] = byVotes(br.candidates);
    expect([first!.name, first!.votes, first!.pct.raw]).toEqual(["FLAVIO BOLSONARO", 56104503, "47,03"]);
    expect([second!.name, second!.votes, second!.pct.raw]).toEqual(["LULA", 53879538, "45,16"]);
  });

  it("computes the difference from integers over validWithSubJudice", () => {
    const [first, second] = byVotes(br.candidates);
    // 2,224,965 / 119,300,788 = 1.8650…% → 187 bp
    expect(difference(first!, second!, br.votes!.validWithSubJudice)).toEqual({ votes: 2224965, bp: 187 });
  });

  it("shows numbers for final/counting and a failed fetch's last good file, never for no_sections", () => {
    expect(hasNumbers(br)).toBe(true);
    expect(hasNumbers({ ...br, status: "fetch_failed" })).toBe(true);
    expect(hasNumbers({ ...br, status: "no_sections" })).toBe(false);
    expect(hasNumbers({ ...br, status: "fetch_failed", votes: null })).toBe(false);
  });

  it("has no difference without valid votes (missing is not zero)", () => {
    const [first, second] = byVotes(br.candidates);
    expect(difference(first!, second!, 0)).toBeNull();
  });
});

describe("freshness", () => {
  const refreshed = Date.parse(pointer.refreshedAt);
  const snap = (serverNow: number, localNow = 1_000): PointerSnapshot => ({
    pointer: { ...pointer, health: { ...pointer.health, recorderSeenAt: pointer.refreshedAt } },
    serverNow,
    localNow,
  });
  const live = { live: true, nationalStatus: "counting" as const };

  it("is amber after 3 min and red after 10 min without a pointer refresh", () => {
    expect(freshness(snap(refreshed + AMBER_AFTER_MS - 1), 1_000, live).level).toBe("ok");
    expect(freshness(snap(refreshed + 4 * 60_000), 1_000, live).level).toBe("amber");
    expect(freshness(snap(refreshed + 11 * 60_000), 1_000, live).level).toBe("red");
  });

  it("ages on the server's clock plus local elapsed time, not the local wall clock", () => {
    // Fetched right after the refresh; 11 minutes pass locally with no new pointer.
    const f = freshness(snap(refreshed, 1_000), 1_000 + 11 * 60_000, live);
    expect(f.level).toBe("red");
    expect(f.ageMs).toBe(11 * 60_000);
  });

  it("names the stage that stopped", () => {
    const s = snap(refreshed + 30_000);
    s.pointer = { ...s.pointer, health: { ...s.pointer.health, recorderSeenAt: new Date(refreshed - RED_AFTER_MS).toISOString() } };
    expect(freshness(s, 1_000, live)).toMatchObject({ level: "red", reason: "a coleta dos arquivos do TSE está sem sinal" });
  });

  it("is never amber/red for a final result or a past round", () => {
    const old = snap(refreshed + 60 * 60_000);
    expect(freshness(old, 1_000, { live: true, nationalStatus: "final" }).level).toBe("final");
    expect(freshness(old, 1_000, { live: false, nationalStatus: "counting" }).level).toBe("past");
  });
});

describe("rounds", () => {
  const p1 = { ...pointer, epoch: "1t-final" };
  const entry1 = { epoch: "1t-final", label: "1º turno", elections: { president: "6257", governor: "6259" }, manifest: { seq: p1.seq, sha: p1.manifest } };

  it("offers the pointer's epoch even without an index, labelled from its election", () => {
    const { rounds, selected } = resolveRounds(p1, null, null, "6257");
    expect(rounds.map((r) => [r.epoch, r.label, r.live])).toEqual([["1t-final", "1º turno", true]]);
    expect(selected.ref).toEqual({ epoch: "1t-final", seq: p1.seq, sha: p1.manifest });
  });

  it("after promotion keeps the 1st round reachable at its fixed manifest", () => {
    const p2 = { ...pointer, epoch: "2t-1", seq: 5, manifest: "a".repeat(64) };
    const index = EpochsIndex.parse({ v: 1, epochs: [entry1, { ...entry1, epoch: "2t-1", label: "2º turno", manifest: null }] });
    const { rounds, selected } = resolveRounds(p2, index, "1t-final");
    expect(rounds.map((r) => [r.epoch, r.live])).toEqual([["1t-final", false], ["2t-1", true]]);
    expect(selected).toMatchObject({ epoch: "1t-final", live: false, ref: { epoch: "1t-final", seq: p1.seq } });
    // An unknown requested epoch falls back to the live round.
    expect(resolveRounds(p2, index, "nope").selected.epoch).toBe("2t-1");
  });
});
