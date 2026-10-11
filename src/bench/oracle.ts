// ORACLE: recomputes what happened from events.jsonl alone and checks the invariants.
// If a card's own numbers disagree with the events, the oracle flags it: then the test is wrong, not the system.
//
//   I1  one delivery per payment        (cards 2, 4)
//   I2  one signed payment per purchase (card 2 buyer side)
//   I3  every delivery has a settlement (card 3)
//   I4  no paid content served unpaid   (card 3 cache)

import fs from "node:fs";
import path from "node:path";
import type { LabEvent } from "../shared/log.js";
import { readJsonl } from "./stats.js";

interface RoundLine { experiment: string; runId: string; round: number; outcome: { metrics?: Record<string, unknown> } }

export function oracle(dir: string) {
  const events = readJsonl<LabEvent>(fs.readFileSync(path.join(dir, "events.jsonl"), "utf8"));
  const rounds = readJsonl<RoundLine>(fs.readFileSync(path.join(dir, "rounds.jsonl"), "utf8"));
  const byRound = new Map<string, LabEvent[]>();
  for (const e of events) {
    const k = `${e.runId}#${e.round}`;
    byRound.set(k, [...(byRound.get(k) ?? []), e]);
  }

  const perRun: Record<string, { rounds: number; I1: number; I2: number; I3: number; I4: number; mismatches: number }> = {};
  for (const r of rounds) {
    const ev = byRound.get(`${r.runId}#${r.round}`) ?? [];
    const count = (pred: (e: LabEvent) => boolean, key: (e: LabEvent) => string | undefined) => {
      const m = new Map<string, number>();
      for (const e of ev) if (pred(e)) { const k = key(e); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const deliveries = count((e) => e.step === "deliver" && e.result === "delivered", (e) => e.authKey);
    const settled = count((e) => e.actor === "chain" && e.result === "settled", (e) => e.authKey);
    const signs = count((e) => e.step === "sign", (e) => e.purchaseId);
    const maxDeliveries = Math.max(0, ...deliveries.values());

    const s = (perRun[r.runId] ??= { rounds: 0, I1: 0, I2: 0, I3: 0, I4: 0, mismatches: 0 });
    s.rounds++;
    if (maxDeliveries > 1) s.I1++;
    if ([...signs.values()].some((n) => n > 1)) s.I2++;
    if ([...deliveries.keys()].some((k) => !settled.has(k))) s.I3++;
    if (ev.some((e) => e.actor === "cache" && e.result === "hit" && e.data?.paid === false)) s.I4++;
    const claimed = r.outcome.metrics?.deliveries;
    if (typeof claimed === "number" && claimed !== maxDeliveries) s.mismatches++;
  }

  const result = { checkedRounds: rounds.length, perRun };
  fs.writeFileSync(path.join(dir, "invariants.json"), JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(oracle(process.argv[2]), null, 2));
