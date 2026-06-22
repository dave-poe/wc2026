import { describe, it, expect } from "vitest";
import {
  computeStandings,
  computeThirdPlaced,
  computeQualifiedThird,
  allGroupsComplete,
  computeEliminated,
  resolvePrizes,
  buildLeaderboard,
  buildTeamOwner,
  buildPayload,
} from "../../lib/sweepstake.mjs";

// Helper: build a 6-fixture group with given scores in the canonical order.
// Teams [A, B, C, D] → fixtures: A-B, C-D, A-C, B-D, A-D, B-C.
function group(name, teams, scores = []) {
  const pairs = [
    [teams[0], teams[1]],
    [teams[2], teams[3]],
    [teams[0], teams[2]],
    [teams[1], teams[3]],
    [teams[0], teams[3]],
    [teams[1], teams[2]],
  ];
  return pairs.map(([home, away], i) => ({
    group: name,
    home,
    away,
    homeScore: scores[i]?.[0] ?? null,
    awayScore: scores[i]?.[1] ?? null,
  }));
}

describe("computeStandings", () => {
  it("computes Pts, GD, GF and sorts by them", () => {
    const groups = { A: ["T1", "T2", "T3", "T4"] };
    const fixtures = group("A", ["T1", "T2", "T3", "T4"], [
      [2, 0], // T1 beats T2
      [1, 1], // T3 draws T4
      [3, 0], // T1 beats T3
      [0, 0], // T2 draws T4
      [1, 0], // T1 beats T4
      [2, 1], // T2 beats T3
    ]);
    const { standings, flags } = computeStandings(groups, fixtures);

    expect(flags).toEqual([]);
    expect(standings.A.map((r) => r.team)).toEqual(["T1", "T2", "T4", "T3"]);
    expect(standings.A[0]).toMatchObject({ team: "T1", P: 3, W: 3, D: 0, L: 0, Pts: 9, GF: 6, GA: 0, GD: 6 });
    expect(standings.A[3]).toMatchObject({ team: "T3", P: 3, Pts: 1, GD: -4 });
  });

  it("flags unresolved Points/GD/GF ties", () => {
    const groups = { A: ["T1", "T2", "T3", "T4"] };
    // Make T1 and T2 finish identical: each wins 1, draws 1, loses 1; GF=GA.
    const fixtures = group("A", ["T1", "T2", "T3", "T4"], [
      [1, 1], // T1-T2 draw
      [2, 2], // T3-T4 draw
      [2, 0], // T1 beats T3
      [2, 0], // T2 beats T4
      [0, 2], // T1 loses to T4
      [0, 2], // T2 loses to T3
    ]);
    const { flags } = computeStandings(groups, fixtures);
    expect(flags.some((f) => f.includes("T1") && f.includes("T2"))).toBe(true);
  });

  it("honours tiebreakOverrides when complete", () => {
    const groups = { A: ["T1", "T2", "T3", "T4"] };
    const fixtures = group("A", ["T1", "T2", "T3", "T4"], [
      [1, 1], [2, 2], [2, 0], [2, 0], [0, 2], [0, 2],
    ]);
    const override = { A: ["T2", "T1", "T4", "T3"] };
    const { standings, flags } = computeStandings(groups, fixtures, override);
    expect(standings.A.map((r) => r.team)).toEqual(["T2", "T1", "T4", "T3"]);
    expect(flags).toEqual([]); // override path doesn't emit flags
  });
});

describe("computeEliminated", () => {
  const groups = { A: ["A1", "A2", "A3", "A4"], B: ["B1", "B2", "B3", "B4"] };

  it("marks 4th-placed out once their group is complete (others remain)", () => {
    const groupFixtures = [
      ...group("A", groups.A, [[3, 0], [3, 0], [3, 0], [0, 3], [3, 0], [0, 3]]),
      ...group("B", groups.B, []), // group B unplayed
    ];
    const { standings } = computeStandings(groups, groupFixtures);
    const eliminated = computeEliminated({
      standings,
      groupFixtures,
      qualifiedThird: new Set(),
      allGroupsDone: false,
      knockout: {},
    });
    // Group A's 4th-placed team is eliminated; nobody from group B is.
    expect(eliminated.has(standings.A[3].team)).toBe(true);
    expect(eliminated.has(standings.A[2].team)).toBe(false); // 3rd not yet decided
    for (const t of groups.B) expect(eliminated.has(t)).toBe(false);
  });

  it("does NOT mark 4th out until the group's last fixture is played", () => {
    const fixtures = group("A", groups.A, [[3, 0], [3, 0], [3, 0], [0, 3], [3, 0]]); // 5/6 played
    const { standings } = computeStandings({ A: groups.A }, fixtures);
    const eliminated = computeEliminated({
      standings,
      groupFixtures: fixtures,
      qualifiedThird: new Set(),
      allGroupsDone: false,
      knockout: {},
    });
    for (const t of groups.A) expect(eliminated.has(t)).toBe(false);
  });

  it("marks 3rd-placed losers of the 8-best cut only once all groups are complete", () => {
    const groupFixtures = [
      ...group("A", groups.A, [[3, 0], [3, 0], [3, 0], [0, 3], [3, 0], [0, 3]]),
      ...group("B", groups.B, [[3, 0], [3, 0], [3, 0], [0, 3], [3, 0], [0, 3]]),
    ];
    const { standings } = computeStandings(groups, groupFixtures);
    // Pretend the 8-best cut excludes group A's 3rd-placed team.
    const qualifiedThird = new Set([standings.B[2].team]);
    const eliminated = computeEliminated({
      standings,
      groupFixtures,
      qualifiedThird,
      allGroupsDone: true,
      knockout: {},
    });
    expect(eliminated.has(standings.A[2].team)).toBe(true);
    expect(eliminated.has(standings.B[2].team)).toBe(false);
  });

  it("marks knockout losers eliminated", () => {
    const knockout = {
      roundOf32: [{ home: "X", away: "Y", winner: "X" }],
      final: { home: "P", away: "Q", winner: "Q" },
    };
    const eliminated = computeEliminated({
      standings: {},
      groupFixtures: [],
      qualifiedThird: new Set(),
      allGroupsDone: false,
      knockout,
    });
    expect(eliminated.has("Y")).toBe(true);
    expect(eliminated.has("P")).toBe(true);
    expect(eliminated.has("X")).toBe(false);
    expect(eliminated.has("Q")).toBe(false);
  });

  it("ignores knockout entries where winner matches neither side", () => {
    const knockout = {
      roundOf32: [{ home: "X", away: "Y", winner: "Z" }], // typo
    };
    const eliminated = computeEliminated({
      standings: {},
      groupFixtures: [],
      qualifiedThird: new Set(),
      allGroupsDone: false,
      knockout,
    });
    expect(eliminated.size).toBe(0);
  });
});

describe("computeThirdPlaced + computeQualifiedThird", () => {
  it("sorts third-placed teams across groups and takes top 8", () => {
    const standings = {};
    for (let i = 0; i < 12; i++) {
      standings[`G${i}`] = [
        { team: `${i}-1st`, P: 3, Pts: 9, GD: 5, GF: 6 },
        { team: `${i}-2nd`, P: 3, Pts: 6, GD: 2, GF: 4 },
        { team: `${i}-3rd`, P: 3, Pts: 3, GD: i, GF: i },
        { team: `${i}-4th`, P: 3, Pts: 0, GD: -5, GF: 0 },
      ];
    }
    const third = computeThirdPlaced(standings);
    expect(third).toHaveLength(12);
    expect(third[0].team).toBe("11-3rd");
    const qualified = computeQualifiedThird(third);
    expect(qualified.size).toBe(8);
    expect(qualified.has("11-3rd")).toBe(true);
    expect(qualified.has("0-3rd")).toBe(false);
  });

  it("excludes groups with no fixtures played", () => {
    const standings = {
      A: [
        { team: "A1", P: 0, Pts: 0, GD: 0, GF: 0 },
        { team: "A2", P: 0, Pts: 0, GD: 0, GF: 0 },
        { team: "A3", P: 0, Pts: 0, GD: 0, GF: 0 },
        { team: "A4", P: 0, Pts: 0, GD: 0, GF: 0 },
      ],
    };
    expect(computeThirdPlaced(standings)).toEqual([]);
  });
});

describe("allGroupsComplete", () => {
  it("returns true only when every group's fixtures all have scores", () => {
    const groups = { A: ["A1", "A2", "A3", "A4"] };
    const complete = group("A", groups.A, [[1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
    const partial = group("A", groups.A, [[1, 0], [1, 0]]);
    const { standings } = computeStandings(groups, complete);
    expect(allGroupsComplete(standings, complete)).toBe(true);
    expect(allGroupsComplete(standings, partial)).toBe(false);
  });
});

describe("resolvePrizes", () => {
  it("resolves owners via teamOwner map", () => {
    const teamOwner = { Spain: ["Leo"], France: ["Ivan"] };
    const prizes = resolvePrizes({
      winner: { label: "Champion", team: "Spain" },
      runnerUp: { label: "Runner-up", team: "" },
      hatTrick: { label: "Hat-trick", team: "Unowned" },
    }, teamOwner);
    expect(prizes.winner.owners).toEqual(["Leo"]);
    expect(prizes.runnerUp.owners).toEqual([]);
    expect(prizes.hatTrick.owners).toEqual([]); // team not in teamOwner
  });
});

describe("buildLeaderboard", () => {
  it("computes alive/out per person and sorts by alive count then prize count", () => {
    const allocations = {
      Alice: ["A", "B"],
      Bob: ["C"],
      Carol: ["D", "E"],
    };
    const eliminated = new Set(["B", "C", "D"]);
    const prizes = { p1: { label: "First", owners: ["Carol"] } };
    const lb = buildLeaderboard(allocations, eliminated, prizes);

    // Alice: 1 alive, Bob: 0, Carol: 1 (with prize) → Carol > Alice > Bob.
    expect(lb.map((r) => r.person)).toEqual(["Carol", "Alice", "Bob"]);
    expect(lb.find((r) => r.person === "Alice").alive).toEqual(["A"]);
    expect(lb.find((r) => r.person === "Alice").out).toEqual(["B"]);
    expect(lb.find((r) => r.person === "Carol").wonPrizes).toEqual(["First"]);
  });
});

describe("buildTeamOwner", () => {
  it("inverts allocations to team → [people]", () => {
    const owners = buildTeamOwner({ Alice: ["X", "Y"], Bob: ["Y", "Z"] });
    expect(owners).toEqual({ X: ["Alice"], Y: ["Alice", "Bob"], Z: ["Bob"] });
  });
});

describe("buildPayload integration", () => {
  it("produces a payload with expected shape and a deterministic builtAt", () => {
    // Scores chosen so A1 wins all (9 pts, top), A2 loses all (0 pts, bottom).
    const data = {
      meta: { title: "Test Cup" },
      groups: { A: ["A1", "A2", "A3", "A4"] },
      groupFixtures: group("A", ["A1", "A2", "A3", "A4"], [
        [3, 0], // A1 beats A2
        [1, 0], // A3 beats A4
        [2, 0], // A1 beats A3
        [0, 1], // A4 beats A2
        [2, 0], // A1 beats A4
        [1, 0], // A2 loses again — wait, this is A2 vs A3
      ]),
      allocations: { Alice: ["A1"], Bob: ["A2"] },
      prizes: { winner: { label: "Champion", team: "A1" } },
      knockout: {},
    };
    // Reset A2-A3 to be a A3 win to make A2 finish bottom on 0 pts.
    data.groupFixtures[5] = { group: "A", home: "A2", away: "A3", homeScore: 0, awayScore: 2 };

    const { payload, flags } = buildPayload(data, { builtAt: "2026-01-01T00:00:00.000Z" });
    expect(flags).toEqual([]);
    expect(payload.builtAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.meta).toEqual({ title: "Test Cup" });
    expect(payload.standings.A).toHaveLength(4);
    // A1 should be top, A2 should be bottom (0 pts).
    expect(payload.standings.A[0].team).toBe("A1");
    expect(payload.standings.A[3].team).toBe("A2");
    // A2 is 4th in a complete group → eliminated.
    expect(payload.eliminated).toContain("A2");
    // Alice (A1, alive) ranks above Bob (A2, out).
    expect(payload.leaderboard[0].person).toBe("Alice");
    expect(payload.leaderboard[1].person).toBe("Bob");
    expect(payload.leaderboard[1].alive).toEqual([]);
    expect(payload.prizes.winner.owners).toEqual(["Alice"]);
  });
});
