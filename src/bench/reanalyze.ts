// REANALYZE: rebuild summaries and the scoreboard from saved logs, without rerunning anything.
//   npx tsx src/bench/reanalyze.ts
// Runs the oracle and analysis on every benchmark folder in results/, oldest first,
// so the newest run of each card ends up on the scoreboard.

import fs from "node:fs";
import path from "node:path";
import { CARDS } from "../cards/index.js";
import { oracle } from "./oracle.js";
import { analyze } from "./analyze.js";

const root = "results";
const dirs = fs.readdirSync(root).map((d) => path.join(root, d))
  .filter((d) => fs.existsSync(path.join(d, "rounds.jsonl")) && fs.existsSync(path.join(d, "meta.json")))
  .sort((a, b) => fs.statSync(path.join(a, "rounds.jsonl")).mtimeMs - fs.statSync(path.join(b, "rounds.jsonl")).mtimeMs);

fs.rmSync(path.join(root, "scoreboard.json"), { force: true });
for (const d of dirs) {
  const card = CARDS[JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8")).card];
  if (!card) continue;
  const inv = oracle(d);
  analyze(d, card);
  const mismatches = Object.values(inv.perRun).reduce((s, r) => s + r.mismatches, 0);
  console.log(`${path.basename(d)}: ${inv.checkedRounds} rounds, ${mismatches} mismatches`);
}
console.log(`→ ${path.join(root, "scoreboard.json")}`);
