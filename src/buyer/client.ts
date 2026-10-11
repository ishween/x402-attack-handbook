// BUYER CLIENT: request -> 402 -> (agent decides) -> GUARD -> sign -> paid retry.
// Retry policies for card 2:
//   fresh       on timeout, start over and sign again          (no fix: a fresh signature is a fresh charge)
//   same-auth   on timeout, resend the SAME signed payment     (fix: the nonce blocks a second charge)
//   idempotent  same-auth + payment-identifier + check status  (fix, with the seller's cached reply)

import type { SimChain } from "../chain/chain.js";
import type { Guard, Decision, Offer } from "./guard.js";
import type { Wallet } from "./wallet.js";
import { log } from "../shared/log.js";
import { HEADER, type PaymentPayload, type PaymentRequirements, authKey, decode, encode, newId } from "../shared/types.js";

export type RetryPolicy = "fresh" | "same-auth" | "idempotent";

export interface PayOptions {
  wallet: Wallet;
  chain: SimChain;
  taskId: string;
  guard?: Guard;
  offer?: Offer;                                   // what the agent chose (for matchOffer)
  approve?: (req: PaymentRequirements) => Promise<boolean>;   // the agent's own judgement, if asked
  purchaseId?: string;
  context?: string;                                // task data sent with the request (card 5)
  timeoutMs?: number;
  retry?: RetryPolicy;
  maxRetries?: number;
}

export interface PayResult {
  status: number; body: any; purchaseId: string;
  ms?: { total: number; guard: number };   // buyer's total wait, and time spent in the guard
  payments: PaymentPayload[];      // every authorization signed for this purchase
  blocked?: Decision; error?: string;
}

export async function payFetch(url: string, o: PayOptions): Promise<PayResult> {
  const t0 = performance.now();
  let guardMs = 0;
  const r = await payFetchInner(url, o, (ms) => (guardMs += ms));
  return { ...r, ms: { total: +(performance.now() - t0).toFixed(1), guard: +guardMs.toFixed(3) } };
}

async function payFetchInner(url: string, o: PayOptions, addGuardMs: (ms: number) => void): Promise<PayResult> {
  const purchaseId = o.purchaseId ?? newId("pur");
  const domain = new URL(url).host;
  const resource = `GET ${new URL(url).pathname}${new URL(url).search}`;
  const payments: PaymentPayload[] = [];
  let context = o.context;
  let payload: PaymentPayload | undefined;
  let attempt = 0;

  if (o.offer) log({ actor: "buyer", step: "offer", purchaseId, resource: o.offer.resource, amount: o.offer.amount, payTo: o.offer.payTo, data: { short: `chose offer: ${o.offer.resource.replace(/^GET /, "")} at $${(Number(o.offer.amount) / 1e6).toFixed(2)}`, offer: o.offer } });

  // card 5: decide who may see the task data BEFORE anything is sent
  if (o.guard) {
    const d = o.guard.beforeRequest(domain, Boolean(context));
    if (d.check !== "none") log({ actor: "guard", step: "before-request", purchaseId, resource, result: d.allow ? "allowed" : "blocked", reason: d.reason, data: { short: d.reason } });
    if (!d.allow) return { status: 0, body: null, purchaseId, payments, blocked: d };
    if (d.stripSensitive) context = undefined;
  }

  const send = async (p?: PaymentPayload) => {
    const headers: Record<string, string> = { [HEADER.PURCHASE]: purchaseId };
    if (context) headers[HEADER.CONTEXT] = context;
    if (p) headers[HEADER.SIGNATURE] = encode(p);
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, headers: r.headers, body };
  };

  while (true) {
    try {
      if (!payload) {
        const first = await send();
        if (first.status !== 402) return { status: first.status, body: first.body, purchaseId, payments };
        const req = decode<{ accepts: PaymentRequirements[] }>(first.headers.get(HEADER.REQUIRED)!).accepts[0];

        if (o.approve && !(await o.approve(req))) {
          const blocked = { allow: false, check: "agent", reason: "agent declined" };
          return { status: 402, body: null, purchaseId, payments, blocked };
        }
        if (o.guard) {
          const g0 = performance.now();
          const d = o.guard.check({ req, offer: o.offer, taskId: o.taskId, domain });
          addGuardMs(performance.now() - g0);
          log({ actor: "guard", step: "guard", purchaseId, resource: req.resource, amount: req.amount, payTo: req.payTo, result: d.allow ? "allowed" : "blocked", reason: d.reason, data: { check: d.check, short: d.short, checks: d.checks, policy: o.guard.describe() } });
          if (!d.allow) return { status: 402, body: null, purchaseId, payments, blocked: d };
        }
        payload = await o.wallet.sign(req, o.chain);
        if (o.retry === "idempotent") payload.extensions = { "payment-identifier": { id: purchaseId } };
        payments.push(payload);
        log({ actor: "buyer", step: "sign", purchaseId, authKey: authKey(payload), resource: req.resource, amount: req.amount, payTo: req.payTo });
      }
      const paid = await send(payload);
      log({ actor: "seller", to: "buyer", step: "response", purchaseId, authKey: authKey(payload), resource, result: paid.status === 200 ? "ok" : String(paid.status), reason: paid.body?.error });
      return { status: paid.status, body: paid.body, purchaseId, payments };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (!timedOut) throw e;
      log({ actor: "buyer", step: "timeout", purchaseId, resource, result: "timeout", data: { attempt, policy: o.retry ?? "none" } });
      if (attempt++ >= (o.maxRetries ?? 0)) return { status: 0, body: null, purchaseId, payments, error: "timeout" };
      if (o.retry === "fresh") payload = undefined;           // NO FIX: sign again
      if (o.retry === "idempotent" && payload) {              // FIX: look before you retry
        const used = o.chain.isNonceUsed(o.chain.asset(payload.accepted.asset), payload.payload.authorization);
        log({ actor: "buyer", step: "status-check", purchaseId, authKey: authKey(payload), result: used ? "settled" : "pending" });
      }
    }
  }
}
