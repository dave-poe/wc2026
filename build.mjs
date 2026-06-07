#!/usr/bin/env node
/**
 * build.mjs — reads results.json, computes the payload via lib/sweepstake.mjs,
 * writes index.html. Zero dependencies. Run: node build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPayload } from "./lib/sweepstake.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "results.json"), "utf8"));
const template = readFileSync(join(__dirname, "template.html"), "utf8");

const { payload, flags } = buildPayload(data);

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
