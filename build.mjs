#!/usr/bin/env node
/**
 * build.mjs — reads results.json, computes everything, writes index.html.
 * Zero dependencies. Run: node build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "results.json"), "utf8"));
const template = readFileSync(join(__dirname, "template.html"), "utf8");

// ISO codes for flagcdn.com. England/Scotland use GB subdivision codes.
const flagISO = {
  "Mexico":"mx","South Africa":"za","South Korea":"kr","Czechia":"cz",
  "Canada":"ca","Bosnia and Herzegovina":"ba","Qatar":"qa","Switzerland":"ch",
  "Brazil":"br","Morocco":"ma","Haiti":"ht","Scotland":"gb-sct",
  "United States":"us","Paraguay":"py","Australia":"au","Turkey":"tr",
  "Germany":"de","Curaçao":"cw","Côte d'Ivoire":"ci","Ecuador":"ec",
  "Netherlands":"nl","Japan":"jp","Sweden":"se","Tunisia":"tn",
  "Belgium":"be","Egypt":"eg","Iran":"ir","New Zealand":"nz",
  "Spain":"es","Cape Verde":"cv","Saudi Arabia":"sa","Uruguay":"uy",
  "France":"fr","Senegal":"sn","Iraq":"iq","Norway":"no",
  "Argentina":"ar","Algeria":"dz","Austria":"at","Jordan":"jo",
  "Portugal":"pt","DR Congo":"cd","Uzbekistan":"uz","Colombia":"co",
  "England":"gb-eng","Croatia":"hr","Ghana":"gh","Panama":"pa"
};

// --- reverse map: team -> [owners] --------------------------------------
const teamOwner = {};
for (const [person, teams] of Object.entries(data.allocations || {})) {
  for (const t of teams) (teamOwner[t] = teamOwner[t] || []).push(person);
}

// --- compute group standings --------------------------------------------
function blankRow(team) {
  return { team, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
}

const standings = {}; // group -> [rows] sorted
const flags = [];     // unresolved-tie flags

for (const [group, teams] of Object.entries(data.groups)) {
  const rows = {};
  for (const t of teams) rows[t] = blankRow(t);

  const fixtures = data.groupFixtures.filter((f) => f.group === group);
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
  const override = (data.tiebreakOverrides || {})[group];
  if (override && override.length === teams.length) {
    ordered.sort((x, y) => override.indexOf(x.team) - override.indexOf(y.team));
  } else {
    ordered.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF);
    // detect ties the engine can't resolve (equal Pts/GD/GF) among played teams
    for (let i = 0; i < ordered.length - 1; i++) {
      const x = ordered[i], y = ordered[i + 1];
      if (x.P > 0 && y.P > 0 && x.Pts === y.Pts && x.GD === y.GD && x.GF === y.GF) {
        flags.push(`Group ${group}: ${x.team} vs ${y.team} tied on Pts/GD/GF — set tiebreakOverrides.${group}`);
      }
    }
  }
  standings[group] = ordered;
}

// --- third-place ranking (8 best of 12 advance) -------------------------
const thirdPlaced = Object.entries(standings)
  .map(([g, rows]) => ({ group: g, ...rows[2] }))
  .filter((r) => r.P > 0);
thirdPlaced.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF);
const allGroupsComplete = Object.entries(standings).every(([g]) =>
  data.groupFixtures.filter((f) => f.group === g)
    .every((f) => f.homeScore != null && f.awayScore != null)
);
const qualifiedThird = new Set(thirdPlaced.slice(0, 8).map((r) => r.team));

// --- resolve prizes ------------------------------------------------------
const prizes = {};
for (const [key, p] of Object.entries(data.prizes)) {
  prizes[key] = {
    label: p.label,
    team: p.team || "",
    owners: p.team ? (teamOwner[p.team] || []) : [],
    note: p.note || ""
  };
}

// --- per-person live status ---------------------------------------------
const eliminated = new Set();
if (allGroupsComplete) {
  for (const [g, rows] of Object.entries(standings)) {
    rows.forEach((r, i) => {
      if (i >= 2 && !qualifiedThird.has(r.team)) eliminated.add(r.team);
    });
  }
}
// knockout eliminations
const ko = data.knockout || {};
for (const stage of ["roundOf32", "roundOf16", "quarterFinals", "semiFinals"]) {
  for (const m of ko[stage] || []) {
    if (m.winner && m.home && m.away) {
      eliminated.add(m.winner === m.home ? m.away : m.home);
    }
  }
}
if (ko.final && ko.final.winner) {
  const loser = ko.final.winner === ko.final.home ? ko.final.away : ko.final.home;
  if (loser) eliminated.add(loser);
}

const leaderboard = Object.entries(data.allocations).map(([person, teams]) => {
  const alive = teams.filter((t) => !eliminated.has(t));
  const wonPrizes = Object.values(prizes).filter((p) => p.owners.includes(person)).map((p) => p.label);
  return { person, teams, alive, out: teams.filter((t) => eliminated.has(t)), wonPrizes };
});
leaderboard.sort((a, b) => b.alive.length - a.alive.length || b.wonPrizes.length - a.wonPrizes.length);

// --- payload -------------------------------------------------------------
const payload = {
  meta: data.meta,
  standings,
  groupFixtures: data.groupFixtures,
  thirdPlaced,
  qualifiedThird: [...qualifiedThird],
  allGroupsComplete,
  prizes,
  leaderboard,
  teamOwner,
  flagISO,
  knockout: ko,
  eliminated: [...eliminated],
  builtAt: new Date().toISOString()
};

const out = template.replace(
  "/*__DATA__*/",
  `window.__SWEEPSTAKE__ = ${JSON.stringify(payload)};`
);
writeFileSync(join(__dirname, "index.html"), out);

console.log("Built index.html");
if (flags.length) {
  console.log("\n⚠ Tiebreak flags (resolve in results.json → tiebreakOverrides):");
  flags.forEach((f) => console.log("  - " + f));
}
