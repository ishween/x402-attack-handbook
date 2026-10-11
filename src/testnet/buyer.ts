// OFFICIAL BUYER: the real x402 client (@x402/core + @x402/fetch + @x402/evm) with YOUR GUARD
// plugged into its before-payment hook. The SDK's own spend controls stay ON (default: $1 cap per
// payment, well-known coins only), so the demo shows the real SDK as people use it.

import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { Guard, type Offer } from "../buyer/guard.js";
import { log } from "../shared/log.js";
import { HEADER, type Hex, type PaymentRequirements, newId } from "../shared/types.js";
import { TESTNET } from "./env.js";

// Why a paid request did not come back 200. The seller puts the reason in the PAYMENT-REQUIRED header
// (for example a failed settlement), or in the body.
function whyNot(res: Response, body: any, text: string): string {
  const h = res.headers.get("PAYMENT-REQUIRED");
  if (h) { try { const d: any = decodePaymentRequiredHeader(h); if (d?.error) return String(d.error); } catch { /* ignore */ } }
  if (body && typeof body === "object" && Object.keys(body).length === 0) return res.status === 402 ? "the seller says the payment did not go through (see the seller line above)" : "empty reply";
  if (body && typeof body === "object") return String(body.error ?? body.message ?? JSON.stringify(body)).slice(0, 200);
  return (text || "no reason given").slice(0, 200);
}

export interface BuyResult { status: number; body: any; tx?: string; blocked?: string; error?: string; purchaseId: string }

export function officialBuyer(o: {
  key: Hex; taskId: string; guard?: Guard; offer?: Offer;
  approve?: (req: PaymentRequirements, purchaseId: string) => Promise<boolean>;
  sdkSpendControls?: boolean;   // default true (the SDK default)
}) {
  const account = privateKeyToAccount(o.key);
  const client = new x402Client().register(TESTNET.network, new ExactEvmScheme(account));
  if (o.sdkSpendControls === false) client.setSpendControls(false);
  let current = { purchaseId: "", blocked: undefined as string | undefined };

  // THE GUARD, in the official hook. Returning { abort } stops the SDK before it signs anything.
  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements: r }) => {
    const url = new URL(paymentRequired.resource.url);
    const req: PaymentRequirements = {
      scheme: "exact", network: r.network, asset: r.asset as Hex, amount: r.amount, payTo: r.payTo as Hex,
      resource: `GET ${url.pathname}${url.search}`, maxTimeoutSeconds: r.maxTimeoutSeconds, description: paymentRequired.resource.description,
    };
    log({ actor: "seller", to: "buyer", step: "402", purchaseId: current.purchaseId, resource: req.resource, amount: req.amount, payTo: req.payTo, data: { asset: req.asset, description: req.description } });
    if (o.approve && !(await o.approve(req, current.purchaseId))) {
      current.blocked = "agent declined";
      return { abort: true, reason: "agent declined" };
    }
    if (o.guard) {
      const d = o.guard.check({ req, offer: o.offer, taskId: o.taskId, domain: url.host });
      log({ actor: "guard", step: "guard", purchaseId: current.purchaseId, resource: req.resource, amount: req.amount, payTo: req.payTo, result: d.allow ? "allowed" : "blocked", reason: d.reason, data: { check: d.check, short: d.short, checks: d.checks, policy: o.guard.describe() } });
      if (!d.allow) { current.blocked = `guard: ${d.reason}`; return { abort: true, reason: d.reason }; }
    }
  });
  client.onAfterPaymentCreation(async ({ paymentPayload, selectedRequirements: r }) => {
    const nonce = (paymentPayload.payload as any)?.authorization?.nonce;
    log({ actor: "buyer", step: "sign", purchaseId: current.purchaseId, amount: r.amount, payTo: r.payTo, data: { nonce } });
  });

  const fetchPay = wrapFetchWithPayment(fetch, client);

  return async function buy(url: string): Promise<BuyResult> {
    const purchaseId = newId("pur");
    current = { purchaseId, blocked: undefined };
    if (o.offer) log({ actor: "buyer", step: "offer", purchaseId, resource: o.offer.resource, amount: o.offer.amount, payTo: o.offer.payTo, data: { short: `chose offer: ${o.offer.resource.replace(/^GET /, "")} at $${(Number(o.offer.amount) / 1e6).toFixed(2)}` } });
    try {
      const res = await fetchPay(url, { headers: { [HEADER.PURCHASE]: purchaseId } });
      const text = await res.text();
      let body: any = text; try { body = JSON.parse(text); } catch { /* not json */ }
      const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
      const tx = header ? (decodePaymentResponseHeader(header) as any)?.transaction : undefined;
      let error: string | undefined;
      if (res.status !== 200) error = `HTTP ${res.status}: ${whyNot(res, body, text)}`;
      log({ actor: "seller", to: "buyer", step: "response", purchaseId, result: res.status === 200 ? "ok" : String(res.status), reason: error, data: { transaction: tx } });
      return { status: res.status, body, tx, purchaseId, error };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const blocked = current.blocked ?? (/spend|cap|max|asset/i.test(msg) ? `SDK spend control: ${msg}` : undefined);
      if (blocked?.startsWith("SDK")) log({ actor: "guard", step: "guard", purchaseId, result: "blocked", reason: blocked, data: { short: "SDK default spend control", check: "sdk" } });
      return { status: 0, body: null, purchaseId, blocked, error: blocked ? undefined : msg };
    }
  };
}
