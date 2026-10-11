// The world every card starts from: a chain, a facilitator, a funded buyer, an empty wallet,
// and fixed wallets for the honest seller, the attacker and a lookalike.
// Fixed keys keep runs reproducible. They are PUBLIC lab-only keys: once this repo is on
// GitHub anyone can read them, so never fund these addresses on a real or test network.

import { privateKeyToAccount } from "viem/accounts";
import { SimChain } from "./chain/chain.js";
import { Facilitator, type FacilitatorMode } from "./facilitator/facilitator.js";
import { Wallet } from "./buyer/wallet.js";
import { EURC, USDC, type Hex } from "./shared/types.js";

const key = (byte: string) => ("0x" + byte.repeat(32)) as Hex;
const addr = (byte: string) => privateKeyToAccount(key(byte)).address;

export const WALLETS = {
  seller: addr("5e"),      // honest seller
  sellerNew: addr("5f"),   // honest seller after a legitimate wallet rotation (card 5)
  attacker: addr("ad"),    // where bait payments and text instructions send money
  lookalike: addr("1c"),   // lookalike seller (card 5)
};

export interface World { chain: SimChain; facilitator: Facilitator; buyer: Wallet; empty: Wallet; close(): void }

export function makeWorld(mode: FacilitatorMode = "strict", blockTimeMs = 50): World {
  const chain = new SimChain([USDC, EURC], blockTimeMs);
  const buyer = new Wallet(key("b1"));
  const empty = new Wallet(key("e0"));
  chain.fund(USDC, buyer.address, 100_000_000n);   // $100 test USDC
  chain.fund(EURC, buyer.address, 100_000_000n);   // so the "different coin" attack can settle
  return { chain, facilitator: new Facilitator(chain, mode), buyer, empty, close: () => chain.stop() };
}
