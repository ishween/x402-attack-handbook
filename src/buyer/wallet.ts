// BUYER WALLET: signs EIP-3009 authorizations. Testnet keys only.

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SimChain } from "../chain/chain.js";
import {
  type Hex, type PaymentPayload, type PaymentRequirements, TRANSFER_TYPES, domainFor, randomNonce, typedMessage,
} from "../shared/types.js";

export class Wallet {
  readonly account: PrivateKeyAccount;
  constructor(privateKey: Hex) { this.account = privateKeyToAccount(privateKey); }
  get address(): Hex { return this.account.address; }

  /** Sign exactly what the 402 asks for. Every call makes a NEW nonce = a new charge. */
  async sign(req: PaymentRequirements, chain: SimChain): Promise<PaymentPayload> {
    const authorization = {
      from: this.address, to: req.payTo, value: req.amount, validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds), nonce: randomNonce(),
    };
    const signature = await this.account.signTypedData({
      domain: domainFor(chain.asset(req.asset), chain.chainId), types: TRANSFER_TYPES,
      primaryType: "TransferWithAuthorization", message: typedMessage(authorization),
    });
    return { x402Version: 2, accepted: req, payload: { signature, authorization } };
  }
}
