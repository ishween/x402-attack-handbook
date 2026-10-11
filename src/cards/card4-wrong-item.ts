// CARD 4 · Right payment, wrong item
// The swap: one payment for the basic summary is also presented to the premium route.
// The signature covers who gets paid, how much and when, not which item it pays for.
// After delivery: does the buyer notice a wrong, empty or useless reply?
//
// Seller (swap): K0 per-route memory | K1 one shared memory | K2 shared memory + payment bound to one item
// All swap sellers deliver on verify, to isolate the binding question.

import type { Card, Config, Env } from "./card.js";
import { getQuote, sendPaid } from "./card.js";
import { makeWorld, WALLETS } from "../lab.js";
import { startSeller } from "../seller/seller.js";
import { payFetch } from "../buyer/client.js";
import { log } from "../shared/log.js";
import { atomic, authKey, newId, sleep } from "../shared/types.js";

const SELLERS = {
  K0: { dedupe: "per-route", bindResource: false },
  K1: { dedupe: "shared", bindResource: false },
  K2: { dedupe: "shared", bindResource: true },
} as const;

export const card4: Card = {
  id: "card4",
  title: "Right payment, wrong item",
  experiments: {
    swap: {
      question: "Can a payment made for the basic item unlock the premium item?",
      rounds: 10,
      matrix: { seller: ["K0", "K1", "K2"], attack: ["X1-both-at-once", "X2-premium-only", "X3-premium-costs-more"] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld();
        const premium = c.attack === "X3-premium-costs-more" ? atomic(0.50) : atomic(0.05);
        const seller = await startSeller({
          name: "summaries", payTo: WALLETS.seller, facilitator: w.facilitator, serveOn: "verify",
          prices: { "/premium-summary": premium }, ...SELLERS[c.seller as keyof typeof SELLERS],
        });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const basic = env.seller.url + "/summary", premium = env.seller.url + "/premium-summary";
        const purchaseId = newId("pur");
        const p = await env.w.buyer.sign(await getQuote(basic, purchaseId), env.w.chain);   // paid for BASIC
        if (c.attack === "X1-both-at-once") await Promise.all([sendPaid(basic, p, purchaseId), sendPaid(premium, p, purchaseId)]);
        else await sendPaid(premium, p, purchaseId);
        await env.seller.drain(); await sleep(env.w.chain.blockTimeMs * 2);
        const got: string[] = env.seller.deliveries.get(authKey(p)) ?? [];
        const unlocked = got.includes("GET /premium-summary");
        return { success: unlocked, metrics: { delivered: got.length, items: got.join(",") || "none", sellerLossUsd: unlocked ? 0.05 : 0 } };
      },
    },

    "after-delivery": {
      question: "The payment was right. Was the reply right? Which checks catch which bad reply?",
      rounds: 5,
      matrix: { delivery: ["correct", "wrong-id", "empty", "wrong-content"], check: ["none", "code", "code+judge"] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld();
        const seller = await startSeller({ name: "summaries", payTo: WALLETS.seller, facilitator: w.facilitator, delivery: c.delivery as any });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const r = await payFetch(env.seller.url + "/summary", { wallet: env.w.buyer, chain: env.w.chain, taskId: newId("task") });
        const body = r.body ?? {};
        const codeFlag = body.resource !== "GET /summary" || typeof body.summary !== "string" || body.summary.length < 40;
        // Stand-in for an AI judge: checks two facts the source document states. Swap for a model call.
        const judgeFlag = !/12%/.test(body.summary ?? "") || !/4\.1B/.test(body.summary ?? "");
        const flagged = c.check === "none" ? false : c.check === "code" ? codeFlag : codeFlag || judgeFlag;
        log({ actor: "buyer", step: "delivery-check", purchaseId: r.purchaseId, result: flagged ? "flagged" : "accepted", data: { check: c.check, codeFlag, judgeFlag } });
        const bad = c.delivery !== "correct";
        return { success: bad && !flagged, metrics: { flagged, falseFlag: !bad && flagged, buyerLossUsd: bad && !flagged ? 0.05 : 0 } };
      },
    },
  },
  scoreboard: [
    {
      row: "4a · Swap: basic payment unlocks premium", experiment: "swap",
      cells: {
        "No fix": { where: { seller: "K0", attack: ["X1-both-at-once", "X2-premium-only"] } },
        "Partial fix": { where: { seller: "K1", attack: ["X1-both-at-once", "X2-premium-only"] } },
        "Full fix": { where: { seller: "K2", attack: ["X1-both-at-once", "X2-premium-only"] } },
      },
    },
    {
      row: "4b · Paid, valid, useless", experiment: "after-delivery",
      cells: {
        "No fix": { where: { check: "none", delivery: ["wrong-id", "empty", "wrong-content"] } },
        "Partial fix": { where: { check: "code", delivery: ["wrong-id", "empty", "wrong-content"] } },
        "Full fix": { where: { check: "code+judge", delivery: ["wrong-id", "empty", "wrong-content"] }, open: "judge is a stand-in; quality is not deterministic" },
      },
    },
  ],
};
