// THE GUARD: plain code that runs in the buyer, right before a payment is signed
// (the moment x402 exposes as a "before payment creation" hook).
// No model call. It cannot be talked out of a rule, because it does not read seller text.
//
//   rule          card   question it answers
//   plan          6      Did the user's task (or an approved follow-on) ask for this item?
//   allowlist     5      Is this a known seller, with the same wallet, coin and chain?
//   probation     5      Unknown seller: is the amount tiny enough to risk?
//   matchOffer    1, 4   Does the live 402 equal the offer the agent chose?
//   capPerCall    1      Is one payment too big?
//   taskBudget    1      Does the running total for this task stay under budget?

import type { Hex, PaymentRequirements } from "../shared/types.js";

export interface Offer { resource: string; scheme: string; amount: string; asset: Hex; network: string; payTo: Hex }
export interface Identity { domain: string; payTo: Hex; asset: Hex; network: string }

export interface Policy {
  plan?: { steps: string[]; followOns?: string[] };
  allowlist?: Identity[];
  probationCap?: bigint;
  matchOffer?: boolean;
  capPerCall?: bigint;
  taskBudget?: bigint;
}

export interface Check { rule: string; field?: string; expected: string; got: string; ok: boolean }
export interface Decision {
  allow: boolean; check: string; reason: string;
  short?: string;                 // one line for the trace box
  checks?: Check[];               // every check the guard ran, pass or fail
  stripSensitive?: boolean;
}

export interface PaymentContext { req: PaymentRequirements; offer?: Offer; taskId: string; domain: string }

const allow = (check: string, reason: string, extra: Partial<Decision> = {}): Decision => ({ allow: true, check, reason, ...extra });
const deny = (check: string, reason: string, extra: Partial<Decision> = {}): Decision => ({ allow: false, check, reason, ...extra });
const money = (a: bigint | string) => `$${(Number(a) / 1e6).toFixed(2)}`;
const shortHex = (h: string) => (h.startsWith("0x") && h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

export class Guard {
  private spent = new Map<string, bigint>();
  constructor(readonly policy: Policy = {}) {}

  /** Before any request leaves: who may see the agent's task data? (card 5) */
  beforeRequest(domain: string, sensitive: boolean): Decision {
    const p = this.policy;
    if (!p.allowlist) return allow("none", "no allowlist: request sent");
    if (p.allowlist.some((i) => i.domain === domain)) return allow("allowlist", "known seller");
    if (p.probationCap === undefined) return deny("allowlist", `unknown seller ${domain}: nothing sent`);
    return allow("probation", "unknown seller: sensitive data stripped", { stripSensitive: sensitive });
  }

  /** Right before signing: is THIS payment authorized? Runs every rule and records each result. */
  check({ req, offer, taskId, domain }: PaymentContext): Decision {
    const p = this.policy;
    const amount = BigInt(req.amount);
    const checks: Check[] = [];
    const add = (c: Check) => { checks.push(c); return c.ok; };

    if (p.plan) {
      const allowed = [...p.plan.steps, ...(p.plan.followOns ?? [])];
      add({ rule: "plan", expected: allowed.join(", "), got: req.resource, ok: allowed.includes(req.resource) });
    }

    if (p.allowlist) {
      const known = p.allowlist.find((i) => i.domain === domain);
      if (known) {
        add({ rule: "identity", field: "payTo", expected: known.payTo, got: req.payTo, ok: same(known.payTo, req.payTo) });
        add({ rule: "identity", field: "asset", expected: known.asset, got: req.asset, ok: same(known.asset, req.asset) });
        add({ rule: "identity", field: "network", expected: known.network, got: req.network, ok: known.network === req.network });
      } else if (p.probationCap === undefined) {
        add({ rule: "allowlist", expected: p.allowlist.map((i) => i.domain).join(", "), got: domain, ok: false });
      } else {
        add({ rule: "probation", expected: `≤ ${money(p.probationCap)} (unknown seller)`, got: money(amount), ok: amount <= p.probationCap });
      }
    }

    if (p.matchOffer && offer)
      for (const f of FIELDS) add({ rule: "offer", field: f, expected: String(offer[f]), got: String(req[f]), ok: same(String(offer[f]), String(req[f])) });

    if (p.capPerCall !== undefined)
      add({ rule: "cap", expected: `≤ ${money(p.capPerCall)}`, got: money(amount), ok: amount <= p.capPerCall });

    const total = (this.spent.get(taskId) ?? 0n) + amount;
    if (p.taskBudget !== undefined)
      add({ rule: "budget", expected: `≤ ${money(p.taskBudget)} per task`, got: `${money(total)} after this payment`, ok: total <= p.taskBudget });

    const failed = checks.find((c) => !c.ok);
    if (failed) {
      const what = failed.field ? `${failed.field}: expected ${failed.expected}, got ${failed.got}` : `${failed.rule}: expected ${failed.expected}, got ${failed.got}`;
      const short = failed.field
        ? `${failed.field} ${display(failed.field, failed.expected)} → ${display(failed.field, failed.got)}`
        : `${failed.rule}: ${failed.got}`;
      return deny(failed.field ? failed.rule : failed.rule, what, { short, checks });
    }
    if (p.taskBudget !== undefined) this.spent.set(taskId, total);
    return allow("all", checks.length ? `all ${checks.length} checks passed` : "no rules configured", { short: checks.length ? `${checks.length}/${checks.length} checks passed` : "no rules", checks });
  }

  /** Money asked for in text, not in a 402 (card 6). With a plan in place, never allowed. */
  checkDirectPayment(): Decision {
    return this.policy.plan ? deny("402-only", "payments only come from a 402 for an approved step", { short: "text cannot ask for money" }) : allow("none", "no rule");
  }

  /** A readable summary of the rules, for logs and the trace header. */
  describe(): string {
    const p = this.policy, parts: string[] = [];
    if (p.plan) parts.push(`plan: ${p.plan.steps.join(", ")}`);
    if (p.allowlist) parts.push(`allowlist: ${p.allowlist.length} seller(s)`);
    if (p.probationCap !== undefined) parts.push(`probation ≤ ${money(p.probationCap)}`);
    if (p.matchOffer) parts.push("match the chosen offer");
    if (p.capPerCall !== undefined) parts.push(`cap ${money(p.capPerCall)} per call`);
    if (p.taskBudget !== undefined) parts.push(`budget ${money(p.taskBudget)} per task`);
    return parts.length ? parts.join(" · ") : "no rules (guard off)";
  }
}

const FIELDS = ["resource", "scheme", "amount", "asset", "network", "payTo"] as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const display = (field: string, v: string) => (field === "amount" ? money(v) : shortHex(v));
