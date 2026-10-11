// ANALYZE: rounds.jsonl -> summary.json (one row per setting) + scoreboard.json (the talk slide).
// Charts are drawn by the dashboard from these files, so every number on a slide traces back to raw logs.

import fs from "node:fs";
import path from "node:path";
import type { Card, Config, Value } from "../cards/card.js";
import { readJsonl, wilson } from "./stats.js";

interface RoundLine {
  experiment: string; runId: string; round: number; config: Config;
  outcome: { success: boolean; hits?: number; trials?: number; metrics?: Record<string, Value> };
}

function aggregate(rows: RoundLine[]) {
  let k = 0, n = 0;
  const sums: Record<string, number> = {}, seen: Record<string, number> = {};
  for (const r of rows) {
    if (r.outcome.trials !== undefined) { k += r.outcome.hits ?? 0; n += r.outcome.trials; }
    else { k += r.outcome.success ? 1 : 0; n += 1; }
    for (const [m, v] of Object.entries(r.outcome.metrics ?? {})) {
      if (typeof v === "number" || typeof v === "boolean") { sums[m] = (sums[m] ?? 0) + Number(v); seen[m] = (seen[m] ?? 0) + 1; }
    }
  }
  const metrics: Record<string, number> = Object.fromEntries(Object.keys(sums).map((m) => [m, +(sums[m] / seen[m]).toFixed(3)]));
  // money lost per 1,000 attempts. An attempt is one round, or one request when a round holds many (card 3).
  const attempts = rows.reduce((s, r) => s + (r.outcome.trials ?? 1), 0);
  const lossPer1000Usd = +(((sums.buyerLossUsd ?? 0) + (sums.sellerLossUsd ?? 0)) / Math.max(1, attempts) * 1000).toFixed(2);
  return { k, n, ...wilson(k, n), metrics, lossPer1000Usd };
}

const matches = (c: Config, where: Record<string, Value | Value[]>) =>
  Object.entries(where).every(([key, v]) => (Array.isArray(v) ? v.includes(c[key]) : c[key] === v));

export function analyze(dir: string, card: Card) {
  const rounds = readJsonl<RoundLine>(fs.readFileSync(path.join(dir, "rounds.jsonl"), "utf8"));
  const groups = new Map<string, RoundLine[]>();
  for (const r of rounds) groups.set(r.runId, [...(groups.get(r.runId) ?? []), r]);

  const runs = [...groups.values()].map((rows) => ({
    experiment: rows[0].experiment, runId: rows[0].runId, config: rows[0].config, ...aggregate(rows),
  }));
  const summary = { card: card.id, title: card.title, dir: path.basename(dir), runs };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

  // scoreboard: merge this card's rows into results/scoreboard.json
  const sbPath = path.join(path.dirname(dir), "scoreboard.json");
  const board: Record<string, unknown> = fs.existsSync(sbPath) ? JSON.parse(fs.readFileSync(sbPath, "utf8")) : {};
  for (const row of card.scoreboard) {
    const exp = rounds.filter((r) => r.experiment === row.experiment);
    if (!exp.length) continue;
    const cells = Object.fromEntries(Object.entries(row.cells).filter(([, spec]) => spec).map(([col, spec]) => {
      const a = aggregate(exp.filter((r) => matches(r.config, spec!.where)));
      return [col, { k: a.k, n: a.n, rate: a.rate, lo: a.lo, hi: a.hi, open: spec!.open, lossPer1000Usd: a.lossPer1000Usd }];
    }));
    const prev = (board[row.row] as any) ?? {};
    board[row.row] = { card: card.id, source: path.basename(dir), cells, cost: prev.cost };
  }
  // cost of the full fix, on honest rounds; attached to the card's first scoreboard row with the same experiment
  for (const c of card.costs ?? []) {
    const exp = rounds.filter((r) => r.experiment === c.experiment);
    if (!exp.length) continue;
    const avg = (where: Record<string, Value | Value[]>) => {
      const vals = exp.filter((r) => matches(r.config, where)).map((r) => r.outcome.metrics?.[c.metric]).filter((v) => v !== undefined).map(Number);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const a = avg(c.without), b = avg(c.with);
    if (a === null || b === null) continue;
    const fmt = (v: number) => (c.unit === "%" ? `${Math.round(v * 100)}%` : v < 1 ? `${Math.round(v * 1000)} µs` : `${v.toFixed(1)} ms`);
    const line = `${c.label}: ${fmt(a)} → ${fmt(b)}`;
    const row = card.scoreboard.find((s) => s.experiment === c.experiment);
    if (!row || !board[row.row]) continue;
    const entry = board[row.row] as any;
    entry.cost = [...((entry.cost ?? []) as string[]).filter((l) => !l.startsWith(c.label + ":")), line];
  }
  fs.writeFileSync(sbPath, JSON.stringify(board, null, 2));
  return summary;
}
