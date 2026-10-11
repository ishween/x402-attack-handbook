// DRY-RUN FACILITATOR: a local stand-in with the same HTTP shape as a real facilitator
// (GET /supported, POST /verify, POST /settle). It approves everything and returns a fake transaction.
// Used only with --dry-run, to test the wiring offline. It does NOT check signatures or move money.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { TESTNET } from "./env.js";

export async function startDryFacilitator() {
  let failSettles = Number(process.env.DRY_FAIL_SETTLES ?? 0);   // test hook: fail the first N settles
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const payer = body?.paymentPayload?.payload?.authorization?.from;
    const send = (v: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (req.url?.endsWith("/supported")) return send({ kinds: [{ x402Version: 2, scheme: "exact", network: TESTNET.network }], extensions: [], signers: {} });
    if (req.url?.endsWith("/verify")) return send({ isValid: true, payer });
    if (req.url?.endsWith("/settle") && failSettles > 0) { failSettles--; return send({ success: false, errorReason: "dry run: simulated settle failure", payer, network: TESTNET.network, transaction: "" }); }
    if (req.url?.endsWith("/settle")) return send({ success: true, payer, network: TESTNET.network, transaction: "0x" + "d".repeat(64) });
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(r)) };
}
