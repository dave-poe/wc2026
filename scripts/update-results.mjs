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
const fixtureIndex = new Map(
  data.groupFixtures.map((f) => [fixtureKey(f.home, f.away), f]),
);

const updates = [];
const unmatched = [];

for (const m of matches) {
  if (m.status !== "FINISHED") continue;
  if (m.stage !== "GROUP_STAGE") continue;
  const home = m.homeTeam?.name;
  const away = m.awayTeam?.name;
  if (!home || !away) continue;

  const fixture = fixtureIndex.get(fixtureKey(home, away));
  if (!fixture) {
    unmatched.push(`${home} vs ${away}`);
    continue;
  }
  const hs = m.score?.fullTime?.home;
  const as = m.score?.fullTime?.away;
  if (hs == null || as == null) continue;

  if (fixture.homeScore !== hs || fixture.awayScore !== as) {
    updates.push({
      match: `${home} ${hs}-${as} ${away}`,
      from: `${fixture.homeScore ?? "null"}-${fixture.awayScore ?? "null"}`,
    });
    fixture.homeScore = hs;
    fixture.awayScore = as;
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
