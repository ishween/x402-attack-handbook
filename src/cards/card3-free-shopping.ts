// CARD 3 · Free shopping, three side doors
// Door 1: verify is not settle   (deliver on "looks valid", money never arrives)
// Door 2: the side entrance      (same data on a route with no paywall)
// Door 3: the shared cache       (one buyer pays, the cache serves everyone)

import type { Card, Config, Env } from "./card.js";
import { makeWorld, WALLETS } from "../lab.js";
import { startSeller } from "../seller/seller.js";
import { startCache, type CacheMode } from "../seller/cache.js";
import { payFetch } from "../buyer/client.js";
import { USDC, newId, sleep } from "../shared/types.js";

const MARK = "PAID-REPORT-CONTENT";
const PRICE_USD = 0.05;
const CACHES: Record<string, { cacheControl: "public" | "private"; mode: CacheMode }> = {
  K0: { cacheControl: "public", mode: "respect" },        // seller marks paid replies public
  K1: { cacheControl: "private", mode: "respect" },       // fix: private, no-store
  K2: { cacheControl: "private", mode: "cache-all-200" }, // a CDN rule overrides the header
  K3: { cacheControl: "private", mode: "bypass-paid" },   // fix: header + bypass rule for paid routes
};

export const card3: Card = {
  id: "card3",
  title: "Free shopping",
  experiments: {
    "door1-verify": {
      question: "Does the seller hand over data for a payment that never settles?",
      rounds: 10,
      matrix: { wallet: ["funded", "empty"], facilitator: ["strict", "sig"], serveOn: ["verify", "settle"] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld(c.facilitator as any);
        const seller = await startSeller({ name: "reports", payTo: WALLETS.seller, facilitator: w.facilitator, serveOn: c.serveOn as any });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const wallet = c.wallet === "empty" ? env.w.empty : env.w.buyer;
        const before: bigint = env.w.chain.balanceOf(USDC, WALLETS.seller);
        const r = await payFetch(env.seller.url + "/report", { wallet, chain: env.w.chain, taskId: newId("task") });
        await env.seller.drain(); await sleep(env.w.chain.blockTimeMs * 2);
        const delivered = r.status === 200;
        const settled = env.w.chain.balanceOf(USDC, WALLETS.seller) > before;
        return { success: delivered && !settled, metrics: { delivered, settled, sellerLossUsd: delivered && !settled ? PRICE_USD : 0, buyerWaitMs: r.ms?.total ?? 0 } };
      },
    },

    "door2-side-entrance": {
      question: "Can an unpaid request reach paid data through another route?",
      rounds: 5,
      matrix: { singleGate: [false, true] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld();
        const seller = await startSeller({ name: "reports", payTo: WALLETS.seller, facilitator: w.facilitator, singleGate: c.singleGate as boolean });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env) {
        const paths = ["/report", "/download", "/debug/report"];
        let hits = 0;
        for (const p of paths) {
          const r = await fetch(env.seller.url + p);
          if (r.status === 200 && (await r.text()).includes(MARK)) hits++;
        }
        return { success: hits > 0, hits, trials: paths.length, metrics: { sellerLossUsd: +(hits * PRICE_USD).toFixed(2) } };
      },
    },

    "door3-cache": {
      question: "After one paid request, how many unpaid requests get the paid content from a shared cache?",
      rounds: 1,
      matrix: { cache: ["K0", "K1", "K2", "K3"], requests: [1000] },
      async setup(c: Config): Promise<Env> {
        const w = makeWorld();
        const seller = await startSeller({ name: "reports", payTo: WALLETS.seller, facilitator: w.facilitator, cacheControl: CACHES[c.cache as string].cacheControl });
        return { w, seller, async close() { await seller.close(); w.close(); } };
      },
      async round(env, c) {
        const cache = await startCache(env.seller.url, CACHES[c.cache as string].mode, ["/report"]);   // cold cache
        await payFetch(cache.url + "/report", { wallet: env.w.buyer, chain: env.w.chain, taskId: newId("task") });
        const n = Number(c.requests);
        let hits = 0;
        for (let i = 0; i < n; i += 50) {
          const batch = await Promise.all(Array.from({ length: Math.min(50, n - i) }, async () => {
            const r = await fetch(cache.url + "/report");
            return r.status === 200 && (await r.text()).includes(MARK);
          }));
          hits += batch.filter(Boolean).length;
        }
        await cache.close();
        return { success: hits > 0, hits, trials: n, metrics: { sellerLossUsd: +(hits * PRICE_USD).toFixed(2) } };
      },
    },
  },
  costs: [
    { label: "time per honest purchase (wait for settlement)", experiment: "door1-verify", metric: "buyerWaitMs", unit: "ms", without: { wallet: "funded", facilitator: "strict", serveOn: "verify" }, with: { wallet: "funded", facilitator: "strict", serveOn: "settle" } },
  ],
  scoreboard: [
    {
      row: "3a · Verify is not settle", experiment: "door1-verify",
      cells: {
        "No fix": { where: { wallet: "empty", facilitator: "sig", serveOn: "verify" } },
        "Partial fix": { where: { wallet: "empty", facilitator: "strict", serveOn: "verify" }, open: "relies on the facilitator checking balance" },
        "Full fix": { where: { wallet: "empty", serveOn: "settle" } },
      },
    },
    {
      row: "3b · Side entrance", experiment: "door2-side-entrance",
      cells: {
        "No fix": { where: { singleGate: false } },
        "Full fix": { where: { singleGate: true } },
      },
    },
    {
      row: "3c · Shared cache (leaks per 1,000)", experiment: "door3-cache",
      cells: {
        "No fix": { where: { cache: "K0" } },
        "Partial fix": { where: { cache: "K2" }, open: "no-store alone: a CDN rule overrides it" },
        "Full fix": { where: { cache: "K3" } },
      },
    },
  ],
};
