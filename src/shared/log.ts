// One event log for every party. Each line is one step of one purchase.
// The dashboard draws sequence diagrams straight from these lines.

import fs from "node:fs";
import path from "node:path";

export type Actor = "buyer" | "agent" | "guard" | "cache" | "seller" | "facilitator" | "chain";

export interface LabEvent {
  ts?: string;
  experiment?: string;
  runId?: string;
  round?: number;
  actor: Actor;
  to?: Actor;            // set for messages between parties (drawn as arrows)
  step: string;          // request, 402, decide, guard, sign, verify, settle, mine, deliver, ...
  purchaseId?: string;   // joins every record of one logical purchase
  authKey?: string;      // joins every record of one signed authorization
  resource?: string;
  amount?: string;
  payTo?: string;
  result?: string;       // ok, blocked, valid, invalid, settled, reverted, hit, miss, ...
  reason?: string;
  data?: Record<string, unknown>;
}

interface Ctx { experiment?: string; runId?: string; round?: number }

let ctx: Ctx = {};
let file: fs.WriteStream | null = null;
const listeners: ((e: LabEvent) => void)[] = [];

/** Start writing events for one experiment directory. */
export function openLog(dir: string, experiment: string) {
  fs.mkdirSync(dir, { recursive: true });
  file?.end();
  file = fs.createWriteStream(path.join(dir, "events.jsonl"), { flags: "a" });
  ctx = { experiment };
}

export function setRound(runId: string, round: number) { ctx = { ...ctx, runId, round }; }
export function currentCtx(): Ctx { return { ...ctx }; }
export function onEvent(fn: (e: LabEvent) => void) { listeners.push(fn); }

/** Write one event. Pass `at` to keep the round an async step started in. */
export function log(e: LabEvent, at: Ctx = ctx) {
  const line: LabEvent = { ts: new Date().toISOString(), ...at, ...e };
  file?.write(JSON.stringify(line) + "\n");
  for (const fn of listeners) fn(line);
  if (process.env.LIVE) console.log(pretty(line));
}

export async function closeLog() {
  await new Promise<void>((r) => (file ? file.end(r) : r()));
  file = null;
}

// ---------- terminal output for live demos ----------
const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
const BAD = new Set(["blocked", "invalid", "reverted", "refused", "declined", "leaked", "timeout"]);
const GOOD = new Set(["ok", "valid", "settled", "allowed", "delivered"]);

export function pretty(e: LabEvent): string {
  const color = e.result && BAD.has(e.result) ? C.red : e.result && GOOD.has(e.result) ? C.green : C.dim;
  const who = e.to ? `${e.actor} → ${e.to}` : e.actor;
  const parts = [e.step, e.resource, e.amount && `amount=${e.amount}`, e.result, e.reason].filter(Boolean);
  return `${color}${who.padEnd(24)}${C.reset} ${parts.join("  ")}`;
}
export const colors = C;
