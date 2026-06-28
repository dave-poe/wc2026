// Pure functions that compute the sweepstake payload from results.json data.
// No I/O, no side effects — testable in isolation.

export const flagISO = {
  "Mexico":"mx","South Africa":"za","South Korea":"kr","Czechia":"cz",
  "Canada":"ca","Bosnia-Herzegovina":"ba","Qatar":"qa","Switzerland":"ch",
  "Brazil":"br","Morocco":"ma","Haiti":"ht","Scotland":"gb-sct",
  "United States":"us","Paraguay":"py","Australia":"au","Turkey":"tr",
  "Germany":"de","Curaçao":"cw","Ivory Coast":"ci","Ecuador":"ec",
  "Netherlands":"nl","Japan":"jp","Sweden":"se","Tunisia":"tn",
  "Belgium":"be","Egypt":"eg","Iran":"ir","New Zealand":"nz",
  "Spain":"es","Cape Verde Islands":"cv","Saudi Arabia":"sa","Uruguay":"uy",
  "France":"fr","Senegal":"sn","Iraq":"iq","Norway":"no",
  "Argentina":"ar","Algeria":"dz","Austria":"at","Jordan":"jo",
  "Portugal":"pt","Congo DR":"cd","Uzbekistan":"uz","Colombia":"co",
  "England":"gb-eng","Croatia":"hr","Ghana":"gh","Panama":"pa"
};

const KNOCKOUT_STAGES = ["roundOf32", "roundOf16", "quarterFinals", "semiFinals"];

function blankRow(team) {
  return { team, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
}

export function buildTeamOwner(allocations = {}) {
  const teamOwner = {};
  for (const [person, teams] of Object.entries(allocations)) {
    for (const t of teams) (teamOwner[t] = teamOwner[t] || []).push(person);
  }
  return teamOwner;
}

export function isGroupComplete(group, groupFixtures) {
  return groupFixtures
    .filter((f) => f.group === group)
    .every((f) => f.homeScore != null && f.awayScore != null);
}

// Returns { standings, flags } where flags lists unresolved-tie warnings.
export function computeStandings(groups, groupFixtures, tiebreakOverrides = {}) {
  const standings = {};
  const flags = [];

  for (const [group, teams] of Object.entries(groups)) {
    const rows = {};
    for (const t of teams) rows[t] = blankRow(t);

    const fixtures = groupFixtures.filter((f) => f.group === group);
    for (const f of fixtures) {
      if (f.homeScore == null || f.awayScore == null) continue;
      const h = rows[f.home], a = rows[f.away];
      if (!h || !a) continue;
      h.P++; a.P++;
      h.GF += f.homeScore; h.GA += f.awayScore;
      a.GF += f.awayScore; a.GA += f.homeScore;
      if (f.homeScore > f.awayScore) { h.W++; a.L++; h.Pts += 3; }
      else if (f.homeScore < f.awayScore) { a.W++; h.L++; a.Pts += 3; }
      else { h.D++; a.D++; h.Pts++; a.Pts++; }
    }
    for (const t of teams) rows[t].GD = rows[t].GF - rows[t].GA;

    let ordered = Object.values(rows);
    const override = tiebreakOverrides[group];
    if (override && override.length === teams.length) {
      ordered.sort((x, y) => override.indexOf(x.team) - override.indexOf(y.team));
    } else {
      ordered.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF);
      for (let i = 0; i < ordered.length - 1; i++) {
        const x = ordered[i], y = ordered[i + 1];
        if (x.P > 0 && y.P > 0 && x.Pts === y.Pts && x.GD === y.GD && x.GF === y.GF) {
          flags.push(`Group ${group}: ${x.team} vs ${y.team} tied on Pts/GD/GF — set tiebreakOverrides.${group}`);
        }
      }
    }
    standings[group] = ordered;
  }

  return { standings, flags };
}

// 8 best 3rd-placed teams across all 12 groups advance.
export function computeThirdPlaced(standings) {
  const list = Object.entries(standings)
    .map(([g, rows]) => ({ group: g, ...rows[2] }))
    .filter((r) => r.P > 0);
  list.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF);
  return list;
}

export function computeQualifiedThird(thirdPlaced) {
  return new Set(thirdPlaced.slice(0, 8).map((r) => r.team));
}

export function allGroupsComplete(standings, groupFixtures) {
  return Object.keys(standings).every((g) => isGroupComplete(g, groupFixtures));
}

// Returns a Set of eliminated team names.
// Rules:
//   - 4th-placed: out as soon as their group is complete.
//   - 3rd-placed: out only once all 12 groups are complete and they miss the best-8 cut.
//   - Knockout losers: out immediately.
export function computeEliminated({ standings, groupFixtures, qualifiedThird, allGroupsDone, knockout = {} }) {
  const eliminated = new Set();

  for (const [g, rows] of Object.entries(standings)) {
    if (isGroupComplete(g, groupFixtures) && rows[3]) eliminated.add(rows[3].team);
  }

  if (allGroupsDone) {
    for (const rows of Object.values(standings)) {
      if (rows[2] && !qualifiedThird.has(rows[2].team)) eliminated.add(rows[2].team);
    }
  }

  for (const stage of KNOCKOUT_STAGES) {
    for (const m of knockout[stage] || []) {
      if (m.winner && m.home && m.away && (m.winner === m.home || m.winner === m.away)) {
        eliminated.add(m.winner === m.home ? m.away : m.home);
      }
    }
  }
  const final = knockout.final;
  if (final && final.winner && final.home && final.away && (final.winner === final.home || final.winner === final.away)) {
    eliminated.add(final.winner === final.home ? final.away : final.home);
  }

  return eliminated;
}

export function resolvePrizes(prizesIn = {}, teamOwner) {
  const out = {};
  for (const [key, p] of Object.entries(prizesIn)) {
    out[key] = {
      label: p.label,
      team: p.team || "",
      owners: p.team ? (teamOwner[p.team] || []) : [],
      note: p.note || ""
    };
  }
  return out;
}

export function buildLeaderboard(allocations, eliminated, prizes) {
  const rows = Object.entries(allocations).map(([person, teams]) => {
    const alive = teams.filter((t) => !eliminated.has(t));
    const wonPrizes = Object.values(prizes)
      .filter((p) => p.owners.includes(person))
      .map((p) => p.label);
    return {
      person,
      teams,
      alive,
      out: teams.filter((t) => eliminated.has(t)),
      wonPrizes
    };
  });
  rows.sort((a, b) => b.alive.length - a.alive.length || b.wonPrizes.length - a.wonPrizes.length);
  return rows;
}

// Top-level: take results.json data, return the full payload + tiebreak flags.
export function buildPayload(data, { builtAt = new Date().toISOString() } = {}) {
  const teamOwner = buildTeamOwner(data.allocations);
  const { standings, flags } = computeStandings(data.groups, data.groupFixtures, data.tiebreakOverrides);
  const thirdPlaced = computeThirdPlaced(standings);
  const qualifiedThird = computeQualifiedThird(thirdPlaced);
  const allGroupsDone = allGroupsComplete(standings, data.groupFixtures);
  const prizes = resolvePrizes(data.prizes, teamOwner);
  const knockout = data.knockout || {};
  const eliminated = computeEliminated({ standings, groupFixtures: data.groupFixtures, qualifiedThird, allGroupsDone, knockout });
  const leaderboard = buildLeaderboard(data.allocations, eliminated, prizes);

  return {
    payload: {
      meta: data.meta,
      standings,
      groupFixtures: data.groupFixtures,
      thirdPlaced,
      qualifiedThird: [...qualifiedThird],
      allGroupsComplete: allGroupsDone,
      prizes,
      leaderboard,
      teamOwner,
      flagISO,
      knockout,
      eliminated: [...eliminated],
      builtAt
    },
    flags
  };
}
