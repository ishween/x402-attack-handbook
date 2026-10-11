// What a card is: named experiments, each a settings matrix plus setup and one round.
// The runner expands the matrix, runs rounds, and writes logs. Nothing else is card-specific.

import { HEADER, type PaymentPayload, type PaymentRequirements, decode, encode, newId } from "../shared/types.js";

export type Value = string | number | boolean;
export type Config = Record<string, Value>;

export interface Outcome {
  success: boolean;                         // did the attack succeed in this round (harm happened)?
  hits?: number; trials?: number;           // optional: many trials per round (card 3 cache: leaks out of 1,000)
  metrics?: Record<string, Value>;
}

export interface Env { close(): Promise<void> | void; [k: string]: any }

export interface Experiment {
  question: string;
  rounds: number;
  matrix: Record<string, Value[]>;
  exclude?: (c: Config) => boolean;
  setup(c: Config): Promise<Env>;
  round(env: Env, c: Config, i: number): Promise<Outcome>;
}

/** One scoreboard row: which rounds count as "no fix", "partial fix" and "full fix". */
export interface ScoreRow {
  row: string;
  experiment: string;
  cells: Partial<Record<"No fix" | "Partial fix" | "Full fix", { where: Record<string, Value | Value[]>; open?: string }>>;
}

/** What the full fix costs, measured on HONEST rounds only (no attack): time added, honest work blocked. */
export interface CostSpec {
  label: string;                      // e.g. "time per honest purchase"
  experiment: string;
  metric: string;                     // a metric name from the round outcome
  unit: "ms" | "%";
  without: Record<string, Value | Value[]>;
  with: Record<string, Value | Value[]>;
}

export interface Card { id: string; title: string; experiments: Record<string, Experiment>; scoreboard: ScoreRow[]; costs?: CostSpec[] }

export function expand(matrix: Record<string, Value[]>, exclude?: (c: Config) => boolean): Config[] {
  let out: Config[] = [{}];
  for (const [k, values] of Object.entries(matrix)) out = out.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  return exclude ? out.filter((c) => !exclude(c)) : out;
}

export const label = (c: Config) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");

// ---------- raw HTTP helpers for attacks that bypass the honest client ----------
export async function getQuote(url: string, purchaseId = newId("pur")): Promise<PaymentRequirements> {
  const r = await fetch(url, { headers: { [HEADER.PURCHASE]: purchaseId } });
  await r.text();
  return decode<{ accepts: PaymentRequirements[] }>(r.headers.get(HEADER.REQUIRED)!).accepts[0];
}

export async function sendPaid(url: string, p: PaymentPayload, purchaseId: string) {
  const r = await fetch(url, { headers: { [HEADER.SIGNATURE]: encode(p), [HEADER.PURCHASE]: purchaseId } });
  const text = await r.text();
  return { status: r.status, text };
}
