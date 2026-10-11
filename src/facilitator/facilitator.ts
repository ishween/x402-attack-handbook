// FACILITATOR: checks a payment (verify) and submits it to the chain (settle).
// Two modes, so we can show what each check protects:
//   strict: signature, recipient, amount, expiry, nonce not yet used, balance
//   sig:    signature, recipient, amount, expiry only (a weaker implementation)
// Even strict verify is NOT a reservation: two verifies of one payment can both pass.

import { recoverTypedDataAddress } from "viem";
import type { SimChain, Receipt } from "../chain/chain.js";
import { log } from "../shared/log.js";
import { type PaymentPayload, type PaymentRequirements, TRANSFER_TYPES, authKey, domainFor, typedMessage } from "../shared/types.js";

export type FacilitatorMode = "strict" | "sig";
export interface VerifyResult { isValid: boolean; reason?: string }

export class Facilitator {
  constructor(readonly chain: SimChain, readonly mode: FacilitatorMode = "strict") {}

  async verify(p: PaymentPayload, req: PaymentRequirements, purchaseId?: string): Promise<VerifyResult> {
    const a = p.payload.authorization;
    const asset = this.chain.asset(req.asset);
    const now = Math.floor(Date.now() / 1000);
    let reason: string | undefined;

    const signer = await recoverTypedDataAddress({
      domain: domainFor(asset, this.chain.chainId), types: TRANSFER_TYPES,
      primaryType: "TransferWithAuthorization", message: typedMessage(a), signature: p.payload.signature,
    }).catch(() => "0x");

    if (signer.toLowerCase() !== a.from.toLowerCase()) reason = "invalid signature";
    else if (a.to.toLowerCase() !== req.payTo.toLowerCase()) reason = "wrong recipient";
    else if (a.value !== req.amount) reason = "wrong amount";
    else if (now >= Number(a.validBefore)) reason = "authorization expired";
    else if (this.mode === "strict" && this.chain.isNonceUsed(asset, a)) reason = "nonce already used";
    else if (this.mode === "strict" && this.chain.balanceOf(asset, a.from) < BigInt(a.value)) reason = "insufficient balance";

    log({
      actor: "facilitator", to: "seller", step: "verify", purchaseId, authKey: authKey(p),
      resource: req.resource, amount: req.amount, result: reason ? "invalid" : "valid", reason, data: { mode: this.mode },
    });
    return { isValid: !reason, reason };
  }

  async settle(p: PaymentPayload, req: PaymentRequirements, purchaseId?: string): Promise<Receipt> {
    log({ actor: "facilitator", to: "chain", step: "settle", purchaseId, authKey: authKey(p), amount: req.amount, payTo: req.payTo });
    return this.chain.submit(p.payload.authorization, p.payload.signature, this.chain.asset(req.asset), purchaseId);
  }
}
