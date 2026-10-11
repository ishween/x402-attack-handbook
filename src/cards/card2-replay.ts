// CARD 2 · One payment, more than one outcome
// Seller side: the same signed payment sent again (A1) or many times at once (A2).
// Buyer side: the reply is lost after paying; how does the agent retry?
//
// Seller:   S0 delivers on verify, no memory | S1 delivers after settle | S2 settle + claims each payment once
// Facilitator: strict (checks nonce at verify) | sig (signature only)

import type { Card, Config, Env } from "./card.js";
import { getQuote, sendPaid } from "./card.js";
import { makeWorld, WALLETS } from "../lab.js";
import { startSeller } from "../seller/seller.js";
import { payFetch, type RetryPolicy } from "../buyer/client.js";
import { USDC, atomic, authKey, newId, sleep } from "../shared/types.js";

const PRICE = BigInt(atomic(0.05));
const usdOf = (atomic: string | bigint) => +(Number(atomic) / 1e6).toFixed(6);

const SELLERS = {
  S0: { serveOn: "verify", dedupe: "none" },
  S1: { serveOn: "settle", dedupe: "none" },
  S2: { serveOn: "settle", dedupe: "shared" },
} as const;

export const card2: Card = {
  id: "card2",
  title: "Replay and duplicate payment",
  experiments: {
    seller: {
      question: "Can one signed payment produce more than one delivery?",
      rounds: 10,
      matrix: { seller: ["S0", "S1", "S2"], facilitator: ["strict", "sig"], attack: ["A1", "A2"], copies: [1, 5, 10, 20] },
      exclude: (c) => (c.attack === "A1") !== (c.copies === 1),
      async setup(c: Config): Promise<Env> {
        const w = makeWorld(c.facilitator as any);
        const seller = await startSeller({ name: "summary", payTo: WALLETS.seller, facilitator: w.facilitator, ...SELLERS[c.seller as keyof typeof SELLERS] });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const url = env.seller.url + "/summary";
        const before: bigint = env.w.chain.balanceOf(USDC, env.w.buyer.address);
        const purchaseId = newId("pur");
        const p = await env.w.buyer.sign(await getQuote(url, purchaseId), env.w.chain);
        if (c.attack === "A1") {
          await sendPaid(url, p, purchaseId);                                  // honest purchase
          await env.seller.drain(); await sleep(env.w.chain.blockTimeMs * 2); // let it settle
          await sendPaid(url, p, purchaseId);                                  // same payment again
        } else {
          await Promise.all(Array.from({ length: Number(c.copies) }, () => sendPaid(url, p, purchaseId)));
        }
        await env.seller.drain(); await sleep(env.w.chain.blockTimeMs * 2);
        const deliveries = env.seller.deliveries.get(authKey(p))?.length ?? 0;
        const settlements = Number((before - env.w.chain.balanceOf(USDC, env.w.buyer.address)) / PRICE);
        return { success: deliveries > 1, metrics: { deliveries, settlements, sellerLossUsd: usdOf(BigInt(Math.max(0, deliveries - settlements)) * PRICE) } };
      },
    },

    buyer: {
      question: "The reply is lost after the payment settled. Does the agent pay twice, and does it get its result?",
      rounds: 10,
      matrix: { retry: ["fresh", "same-auth", "idempotent"], seller: ["S1", "S2"] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld();
        const seller = await startSeller({ name: "summary", payTo: WALLETS.seller, facilitator: w.facilitator, ...SELLERS[c.seller as keyof typeof SELLERS], replyDelayMs: 400 });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const before: bigint = env.w.chain.balanceOf(USDC, env.w.buyer.address);
        const r = await payFetch(env.seller.url + "/summary", {
          wallet: env.w.buyer, chain: env.w.chain, taskId: newId("task"),
          retry: c.retry as RetryPolicy, timeoutMs: 250, maxRetries: 2,
        });
        await sleep(600); await env.seller.drain();   // let late replies finish
        const charges = Number((before - env.w.chain.balanceOf(USDC, env.w.buyer.address)) / PRICE);
        return { success: charges > 1, metrics: { charges, gotResult: r.status === 200, signed: r.payments.length, buyerLossUsd: usdOf(BigInt(Math.max(0, charges - 1)) * PRICE), buyerWaitMs: r.ms?.total ?? 0 } };
      },
    },
  },
  costs: [
    { label: "buyer gets its result after a timeout", experiment: "buyer", metric: "gotResult", unit: "%", without: { retry: "fresh" }, with: { retry: "idempotent", seller: "S2" } },
  ],
  scoreboard: [
    {
      row: "2a · Burst: extra deliveries (seller loses)", experiment: "seller",
      cells: {
        "No fix": { where: { seller: "S0", attack: "A2" } },
        "Partial fix": { where: { seller: "S1", attack: "A2" } },
        "Full fix": { where: { seller: "S2", attack: "A2" } },
      },
    },
    {
      row: "2b · Timeout: double charge (buyer loses)", experiment: "buyer",
      cells: {
        "No fix": { where: { retry: "fresh" } },
        "Partial fix": { where: { retry: "same-auth", seller: "S1" }, open: "no double charge, but no result either" },
        "Full fix": { where: { retry: "idempotent", seller: "S2" } },
      },
    },
  ],
};
