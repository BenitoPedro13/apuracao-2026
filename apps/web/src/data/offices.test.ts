import { describe, expect, it } from "vitest";
import { LegislativeBrView, LegislativeUfView, ResultView } from "@apuracao/contracts";
import { UFS } from "@apuracao/tse/codes";
import { realView } from "../../test/real";
import { hemicycle, hemicycleGroups, senateClosest, senateElected, shareStep, topVoted, ufBenches } from "./chambers";
import { closestRaces, governorRace, governorSummary, isRunoff, outcomeLabel } from "./governors";

// On the real 1st-round views (TASK-visual-pass-2.md §5 item 1), never hand-built.

const governor = UFS.map((uf) => ResultView.parse(realView(`result/governor/${uf}`)));
const races = UFS.map((uf, i) => governorRace(uf, governor[i], false));

describe("governor races", () => {
  it("reads the TSE's outcomes: 20 elected, 7 runoffs in AC, AM, DF, ES, RJ, RN, TO", () => {
    expect(governorSummary(races)).toEqual({ races: 27, elected: 20, runoff: 7, counting: 0 });
    expect(races.filter((r) => r.outcome === "2turno").map((r) => r.uf)).toEqual(["ac", "am", "df", "es", "rj", "rn", "to"]);
  });

  it("puts RJ's runoff as the TSE has it: Douglas Ruas 49,27, Eduardo Paes 42,76", () => {
    const rj = races.find((r) => r.uf === "rj")!;
    expect([rj.first?.name, rj.first?.pct.raw, rj.second?.name, rj.second?.pct.raw]).toEqual(["DOUGLAS RUAS", "49,27", "EDUARDO PAES", "42,76"]);
    expect(rj.difference).toEqual({ votes: rj.first!.votes - rj.second!.votes, bp: expect.any(Number) });
  });

  it("orders the closest race first, every difference not larger than the next", () => {
    const c = closestRaces(races);
    expect(c).toHaveLength(27);
    for (let i = 1; i < c.length; i++) expect(c[i - 1]!.difference!.bp).toBeLessThanOrEqual(c[i]!.difference!.bp);
    expect(c[0]!.uf).toBe("rn");
  });

  it("says a UF without a race this round has none, and a missing view is loading, not zero", () => {
    expect(governorRace("sp", undefined, true).outcome).toBe("sem-disputa");
    expect(governorRace("sp", undefined, false).outcome).toBe("carregando");
    expect(governorSummary([governorRace("sp", undefined, true)]).races).toBe(0);
  });

  it("labels by round: the 1st round's elected are 'no 1º turno'", () => {
    expect(isRunoff(governor[0])).toBe(false);
    expect(outcomeLabel("eleito", false)).toBe("Eleito no 1º turno");
    expect(outcomeLabel("eleito", true)).toBe("Eleito");
  });
});

const deputies = LegislativeBrView.parse(realView("legislative/federal-deputy/br"));
const senateBr = LegislativeBrView.parse(realView("legislative/senate/br"));
const senate = UFS.map((uf) => LegislativeUfView.parse(realView(`legislative/senate/${uf}`)));
const federal = UFS.map((uf) => LegislativeUfView.parse(realView(`legislative/federal-deputy/${uf}`)));

describe("chambers", () => {
  it("counts each UF's benches from the view: seats add up to nv, largest first", () => {
    const benches = ufBenches(deputies);
    expect(benches).toHaveLength(27);
    for (const b of benches) expect(b.parties.reduce((t, p) => t + p.seats, 0)).toBe(b.seats);
    const sp = benches.find((b) => b.uf === "sp")!;
    expect([sp.seats, sp.largest, sp.parties[0]]).toEqual([70, ["PL"], { party: "PL", seats: 19 }]);
    // Acre: PP 2 and UNIÃO 2, a two-way tie for the largest bench.
    expect(benches.find((b) => b.uf === "ac")!.largest).toEqual(["PP", "UNIÃO"]);
  });

  it("steps a party's share of a UF's seats; zero seats is its own state", () => {
    expect([shareStep(0, 8), shareStep(1, 46), shareStep(1, 8), shareStep(3, 10), shareStep(21, 53)]).toEqual([0, 1, 2, 3, 3]);
    expect(shareStep(4, 8)).toBe(4);
  });

  it("finds the senate's two elected per UF, 54 in all, as the summed view says", () => {
    const elected = senate.map(senateElected);
    expect(elected.every((e) => e.length === 2)).toBe(true);
    expect(elected.flat()).toHaveLength(senateBr.seatsCalc);
  });

  it("orders the senate's closest races by the TSE % gap, RN first", () => {
    const close = senateClosest(senate);
    expect(close[0]!.uf).toBe("rn");
    for (const c of close) {
      expect(c.lastElected.elected).toBe(true);
      expect(c.firstOut.elected).toBe(false);
      expect(c.votes).toBe(c.lastElected.votes - c.firstOut.votes);
    }
  });

  it("ranks the most voted elected deputies across UFs, Nikolas Ferreira first", () => {
    const top = topVoted(federal, 10);
    expect(top).toHaveLength(10);
    expect([top[0]!.name, top[0]!.uf]).toEqual(["NIKOLAS FERREIRA", "mg"]);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.votes).toBeGreaterThanOrEqual(top[i]!.votes);
  });
});

describe("hemicycle", () => {
  it("lays out exactly 513 and 54 seats inside its box, left to right", () => {
    for (const n of [513, 54, 1]) {
      const { seats, r } = hemicycle(n);
      expect(seats).toHaveLength(n);
      expect(r).toBeGreaterThan(0);
      for (const s of seats) {
        expect(s.x).toBeGreaterThanOrEqual(-1e-9);
        expect(s.x).toBeLessThanOrEqual(2 + 1e-9);
        expect(s.y).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("groups the palette parties in seat order and the rest as Outros, nothing lost", () => {
    const groups = hemicycleGroups(deputies.parties.map((p) => ({ party: p.party, seats: p.seatsCalc })));
    expect(groups.reduce((t, g) => t + g.seats, 0)).toBe(513);
    expect(groups[0]).toEqual({ party: "PL", seats: 121 });
    expect(groups.at(-1)!.party).toBeNull();
  });
});
