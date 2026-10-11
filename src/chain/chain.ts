// ON-CHAIN: a small simulated chain with EIP-3009 rules.
// It is honest about the three things the attacks depend on:
//   1. a nonce can be used once        (replay protection, cards 2 and 4)
//   2. money only moves when a block is mined, not at verify time  (card 3)
//   3. recent blocks can be dropped     (card 3, "settlement is not finality")
// Swap this file for a real chain (anvil or Base Sepolia) behind the same methods.

import { recoverTypedDataAddress } from "viem";
import { log, currentCtx } from "../shared/log.js";
import {
  type Asset, type Authorization, type Hex, NETWORK, TRANSFER_TYPES, domainFor, typedMessage, randomNonce,
} from "../shared/types.js";

export interface Receipt { ok: boolean; txHash: Hex; block: number; error?: string }

interface PendingTx {
  auth: Authorization; signature: Hex; asset: Asset; purchaseId?: string;
  at: ReturnType<typeof currentCtx>; done: (r: Receipt) => void;
}
interface Applied { asset: Asset; auth: Authorization }

export class SimChain {
  readonly chainId = NETWORK.chainId;
  height = 0;
  private balances = new Map<string, bigint>();
  private used = new Set<string>();
  private mempool: PendingTx[] = [];
  private blocks: Applied[][] = [];
  private timer?: NodeJS.Timeout;
  private mining = false;

  constructor(readonly assets: Asset[], readonly blockTimeMs = 50) {
    this.timer = setInterval(() => void this.mine(), blockTimeMs);
  }
  stop() { clearInterval(this.timer); }

  asset(address: string): Asset {
    const a = this.assets.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!a) throw new Error(`unknown asset ${address}`);
    return a;
  }
  private bkey = (asset: Asset, who: string) => `${asset.address}:${who}`.toLowerCase();
  private nkey = (asset: Asset, a: Authorization) => `${asset.address}:${a.from}:${a.nonce}`.toLowerCase();

  fund(asset: Asset, who: Hex, amount: bigint) {
    this.balances.set(this.bkey(asset, who), this.balanceOf(asset, who) + amount);
  }
  balanceOf(asset: Asset, who: string) { return this.balances.get(this.bkey(asset, who)) ?? 0n; }
  isNonceUsed(asset: Asset, a: Authorization) { return this.used.has(this.nkey(asset, a)); }

  /** Queue transferWithAuthorization. Resolves when the next block is mined. */
  submit(auth: Authorization, signature: Hex, asset: Asset, purchaseId?: string): Promise<Receipt> {
    return new Promise((done) => this.mempool.push({ auth, signature, asset, purchaseId, at: currentCtx(), done }));
  }

  /** Mine one block: run queued transfers in order. The second use of a nonce reverts. */
  async mine() {
    if (this.mining || this.mempool.length === 0) return;
    this.mining = true;
    const txs = this.mempool.splice(0);
    const applied: Applied[] = [];
    this.height++;
    for (const tx of txs) {
      const error = await this.check(tx);
      const receipt: Receipt = { ok: !error, txHash: randomNonce(), block: this.height, error };
      if (!error) {
        const v = BigInt(tx.auth.value);
        this.balances.set(this.bkey(tx.asset, tx.auth.from), this.balanceOf(tx.asset, tx.auth.from) - v);
        this.balances.set(this.bkey(tx.asset, tx.auth.to), this.balanceOf(tx.asset, tx.auth.to) + v);
        this.used.add(this.nkey(tx.asset, tx.auth));
        applied.push({ asset: tx.asset, auth: tx.auth });
      }
      log({
        actor: "chain", to: "facilitator", step: "mine", purchaseId: tx.purchaseId,
        authKey: `${tx.auth.from.toLowerCase()}:${tx.auth.nonce}`, amount: tx.auth.value, payTo: tx.auth.to,
        result: error ? "reverted" : "settled", reason: error, data: { block: this.height, asset: tx.asset.symbol },
      }, tx.at);
      tx.done(receipt);
    }
    this.blocks.push(applied);
    this.mining = false;
  }

  private async check(tx: PendingTx): Promise<string | undefined> {
    const a = tx.auth, now = BigInt(Math.floor(Date.now() / 1000));
    const signer = await recoverTypedDataAddress({
      domain: domainFor(tx.asset, this.chainId), types: TRANSFER_TYPES,
      primaryType: "TransferWithAuthorization", message: typedMessage(a), signature: tx.signature,
    });
    if (signer.toLowerCase() !== a.from.toLowerCase()) return "invalid signature";
    if (now <= BigInt(a.validAfter) || now >= BigInt(a.validBefore)) return "authorization expired";
    if (this.isNonceUsed(tx.asset, a)) return "nonce already used";
    if (this.balanceOf(tx.asset, a.from) < BigInt(a.value)) return "insufficient balance";
    return undefined;
  }

  /** Lab only: drop the newest block, as a reorg before finality would. */
  dropLastBlock() {
    const last = this.blocks.pop() ?? [];
    for (const { asset, auth } of last) {
      const v = BigInt(auth.value);
      this.balances.set(this.bkey(asset, auth.from), this.balanceOf(asset, auth.from) + v);
      this.balances.set(this.bkey(asset, auth.to), this.balanceOf(asset, auth.to) - v);
      this.used.delete(this.nkey(asset, auth));
      log({ actor: "chain", step: "reorg", authKey: `${auth.from.toLowerCase()}:${auth.nonce}`, result: "reverted", reason: "block dropped before finality" });
    }
    this.height--;
  }
}
