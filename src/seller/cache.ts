// SHARED CACHE (card 3, door three): a tiny CDN in front of the seller.
// Its cache key is method + URL, so it cannot tell a paid request from an unpaid one.
//
//   mode            meaning
//   respect         stores only replies marked public / max-age   (honours the seller's header)
//   cache-all-200   stores every 200, ignoring the header          (a common CDN rule, the override bug)
//   bypass-paid     cache-all-200, but never for paid routes       (the fix: a bypass rule)

import http from "node:http";
import type { AddressInfo } from "node:net";
import { log } from "../shared/log.js";
import { HEADER } from "../shared/types.js";

export type CacheMode = "respect" | "cache-all-200" | "bypass-paid";

export interface CacheProxy { url: string; hits: number; close(): Promise<void> }

export async function startCache(upstream: string, mode: CacheMode, paidPaths: string[]): Promise<CacheProxy> {
  const store = new Map<string, { status: number; headers: Record<string, string>; body: string }>();
  const state = { hits: 0 };

  const server = http.createServer(async (req, res) => {
    const key = `${req.method} ${req.url}`;                 // no payment state in the key
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const cached = store.get(key);
    if (cached) {
      state.hits++;
      log({ actor: "cache", to: "buyer", step: "cache", resource: key, result: "hit", data: { paid: Boolean(req.headers[HEADER.SIGNATURE]) } });
      res.writeHead(cached.status, { ...cached.headers, "x-cache": "HIT" });
      return res.end(cached.body);
    }
    const headers: Record<string, string> = {};
    for (const h of [HEADER.SIGNATURE, HEADER.PURCHASE]) if (req.headers[h]) headers[h] = req.headers[h] as string;
    const up = await fetch(upstream + req.url, { headers });
    const body = await up.text();
    const out: Record<string, string> = {};
    up.headers.forEach((v, k) => (out[k] = v));
    const cc = up.headers.get("cache-control") ?? "";
    const publicReply = /public|max-age/.test(cc) && !/private|no-store/.test(cc);
    const storable =
      up.status === 200 &&
      (mode === "respect" ? publicReply : mode === "cache-all-200" ? true : !paidPaths.includes(path));
    if (storable) store.set(key, { status: up.status, headers: out, body });
    log({ actor: "cache", to: "buyer", step: "cache", resource: key, result: "miss", data: { stored: storable, cacheControl: cc } });
    res.writeHead(up.status, { ...out, "x-cache": "MISS" });
    res.end(body);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get hits() { return state.hits; },
    async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}
