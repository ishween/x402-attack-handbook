// MOCK CATALOG: shaped like Bazaar search results. Lab only, never the real Bazaar.
// A listing is the seller's own words: name, description, price, wallet.

import type { Seller } from "../seller/seller.js";
import type { Offer } from "./guard.js";
import { NETWORK, USDC, type Hex } from "../shared/types.js";

export interface Listing {
  id: string; name: string; description: string; url: string; domain: string;
  resource: string; price: string; payTo: Hex; asset: Hex; network: string;
}

export function listing(id: string, seller: Seller, path: string, price: string, name: string, description: string, payTo = seller.opts.payTo): Listing {
  return {
    id, name, description, url: seller.url + path, domain: seller.domain,
    resource: `GET ${path}`, price, payTo, asset: USDC.address, network: NETWORK.id,
  };
}

/** The agent's saved copy of what it chose: the guard compares the live 402 with this. */
export const offerOf = (l: Listing): Offer => ({
  resource: l.resource, scheme: "exact", amount: l.price, asset: l.asset, network: l.network, payTo: l.payTo,
});
