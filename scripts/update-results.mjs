#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = resolve(__dirname, "..", "results.json");
const API_URL = "https://api.football-data.org/v4/competitions/WC/matches";

const token = process.env.FOOTBALL_DATA_TOKEN;
if (!token) {
  console.error("FOOTBALL_DATA_TOKEN env var is required");
  process.exit(1);
}

const res = await fetch(API_URL, { headers: { "X-Auth-Token": token } });
if (!res.ok) {
  console.error(`API request failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const { matches } = await res.json();

const data = JSON.parse(await readFile(RESULTS_PATH, "utf8"));

const fixtureKey = (home, away) => `${home}::${away}`;
const groupIndex = new Map(
  data.groupFixtures.map((f) => [fixtureKey(f.home, f.away), f]),
);

const KO_STAGE_TO_BUCKET = {
  LAST_32: "roundOf32",
  LAST_16: "roundOf16",
  QUARTER_FINALS: "quarterFinals",
  SEMI_FINALS: "semiFinals",
};
data.knockout = data.knockout || {};
const koIndex = new Map();
for (const bucket of Object.values(KO_STAGE_TO_BUCKET)) {
  for (const f of data.knockout[bucket] || []) {
    koIndex.set(fixtureKey(f.home, f.away), f);
  }
}

const updates = [];
const unmatched = [];

for (const m of matches) {
  if (m.status !== "FINISHED") continue;
  const home = m.homeTeam?.name;
  const away = m.awayTeam?.name;
  if (!home || !away) continue;

  const isGroup = m.stage === "GROUP_STAGE";
  const isKnockout = m.stage === "FINAL" || KO_STAGE_TO_BUCKET[m.stage];
  if (!isGroup && !isKnockout) continue;

  const hs = m.score?.fullTime?.home;
  const as = m.score?.fullTime?.away;
  if (hs == null || as == null) continue;

  if (isGroup) {
    const fixture = groupIndex.get(fixtureKey(home, away));
    if (!fixture) { unmatched.push(`${m.stage}: ${home} vs ${away}`); continue; }
    if (fixture.homeScore !== hs || fixture.awayScore !== as) {
      updates.push({
        match: `${home} ${hs}-${as} ${away}`,
        from: `${fixture.homeScore ?? "null"}-${fixture.awayScore ?? "null"}`,
      });
      fixture.homeScore = hs;
      fixture.awayScore = as;
    }
    continue;
  }

  // knockout
  const fixture = m.stage === "FINAL" ? data.knockout.final : koIndex.get(fixtureKey(home, away));
  if (!fixture || (m.stage !== "FINAL" && !koIndex.has(fixtureKey(home, away)))) {
    unmatched.push(`${m.stage}: ${home} vs ${away}`);
    continue;
  }
  // winner: API gives HOME_WIN/AWAY_WIN (includes ET/penalties). DRAW shouldn't occur for finished KO.
  let winner = "";
  if (m.score?.winner === "HOME_WIN") winner = fixture.home;
  else if (m.score?.winner === "AWAY_WIN") winner = fixture.away;

  const ph = m.score?.penalties?.home ?? null;
  const pa = m.score?.penalties?.away ?? null;
  const hasPens = ph != null && pa != null;

  const changed =
    fixture.homeScore !== hs ||
    fixture.awayScore !== as ||
    (winner && fixture.winner !== winner) ||
    (hasPens && (fixture.penaltiesHome !== ph || fixture.penaltiesAway !== pa));
  if (changed) {
    const pensSuffix = hasPens ? ` (pens ${ph}-${pa})` : "";
    updates.push({
      match: `[${m.stage}] ${home} ${hs}-${as} ${away}${pensSuffix}${winner ? ` (winner: ${winner})` : ""}`,
      from: `${fixture.homeScore ?? "null"}-${fixture.awayScore ?? "null"}`,
    });
    fixture.homeScore = hs;
    fixture.awayScore = as;
    if (winner) fixture.winner = winner;
    if (hasPens) {
      fixture.penaltiesHome = ph;
      fixture.penaltiesAway = pa;
    }
  }
}

if (updates.length === 0) {
  console.log("No score changes.");
} else {
  await writeFile(RESULTS_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`Updated ${updates.length} fixture(s):`);
  for (const u of updates) console.log(`  ${u.match} (was ${u.from})`);
}

if (unmatched.length > 0) {
  console.log(`\nWarning: ${unmatched.length} finished match(es) had no fixture entry:`);
  for (const u of unmatched) console.log(`  ${u}`);
}
