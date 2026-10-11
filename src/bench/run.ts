// RUNNER: expands a card's settings matrix, runs every round, writes raw logs, then checks and analyzes.
//
//   npx tsx src/bench/run.ts card1                      all experiments of card 1
//   npx tsx src/bench/run.ts card2 seller --rounds 50   one experiment, more rounds
//   npx tsx src/bench/run.ts card6 --agent llm          use a real model where the card has an agent
//   npx tsx src/bench/run.ts card1 --where guard=C2     only matching settings
//   npx tsx src/bench/run.ts all                        every card
//
// Output: results/<card>-<time>/ events.jsonl, rounds.jsonl, meta.json, invariants.json, summary.json

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CARDS } from "../cards/index.js";
import { expand, label, type Card, type Config } from "../cards/card.js";
import { openLog, setRound, closeLog } from "../shared/log.js";
import { oracle } from "./oracle.js";
import { analyze } from "./analyze.js";
import { agentModel } from "../buyer/agent.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [target = "card1", only] = positional;
const where = Object.fromEntries((flag("where") ?? "").split(",").filter(Boolean).map((kv) => kv.split("=")));

async function runCard(card: Card) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join("results", `${card.id}-${stamp}`);
  openLog(dir, card.id);
  const rounds = fs.createWriteStream(path.join(dir, "rounds.jsonl"));
  const started = new Date().toISOString();

  for (const [name, exp] of Object.entries(card.experiments)) {
    if (only && only !== name) continue;
    const matrix = { ...exp.matrix };
    if (flag("agent") && matrix.agent) matrix.agent = [flag("agent")!];
    const configs = expand(matrix, exp.exclude).filter((c) => Object.entries(where).every(([k, v]) => String(c[k]) === v));
    const n = Number(flag("rounds") ?? exp.rounds);
    console.log(`\n${card.id} · ${name}: ${configs.length} settings × ${n} rounds`);

    for (const config of configs) {
      const runId = `${name} | ${label(config)}`;
      const env = await exp.setup(config);
      let wins = 0;
      for (let i = 0; i < n; i++) {
        setRound(runId, i);
        const t0 = performance.now();
        const outcome: any = await exp.round(env, config, i).catch((e) => ({ success: false, metrics: { error: String(e) } }));
        outcome.metrics = { ...(outcome.metrics ?? {}), roundMs: +(performance.now() - t0).toFixed(1) };
        if (outcome.success) wins++;
        rounds.write(JSON.stringify({ experiment: name, runId, round: i, config, outcome }) + "\n");
      }
      await env.close();
      console.log(`  ${wins > 0 ? "\x1b[31m" : "\x1b[32m"}${String(wins).padStart(3)}/${n}\x1b[0m  ${label(config)}`);
    }
  }
  await new Promise((r) => rounds.end(r));
  await closeLog();

  const git = (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "none"; } })();
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
    card: card.id, title: card.title, started, finished: new Date().toISOString(), args, git,
    node: process.version, chain: "SimChain (local simulation, EIP-3009 rules)", network: "eip155:84532 (simulated)",
    agent: flag("agent") === "llm" ? agentModel() : undefined,
  }, null, 2));

  const inv = oracle(dir);
  const mismatches = Object.values(inv.perRun).reduce((s, r) => s + r.mismatches, 0);
  analyze(dir, card);
  console.log(`\n→ ${dir}  (oracle: ${inv.checkedRounds} rounds checked, ${mismatches} mismatches)`);
}

const cards = target === "all" ? Object.values(CARDS) : [CARDS[target]];
if (!cards[0]) { console.error(`unknown card "${target}". Try: ${Object.keys(CARDS).join(", ")}, all`); process.exit(1); }
for (const c of cards) await runCard(c);
process.exit(0);
