// Payment shapes, header names and helpers shared by every part of the lab.
// Shapes follow x402 v2, simplified for teaching.

export type Hex = `0x${string}`;

/** HTTP headers x402 uses, plus one header we add to join logs across parties. */
export const HEADER = {
  REQUIRED: "payment-required",   // seller -> buyer, on the 402
  SIGNATURE: "payment-signature", // buyer -> seller, on the paid retry
  RESPONSE: "payment-response",   // seller -> buyer, on the 200
  PURCHASE: "x-purchase-id",      // lab only: one id per logical purchase
  CONTEXT: "x-task-context",      // lab only: task data the agent sends (card 5 canary)
} as const;

/** What the seller asks for in the 402. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;     // CAIP-2, e.g. "eip155:84532"
  asset: Hex;          // token contract
  amount: string;      // atomic units, USDC has 6 decimals: "50000" = $0.05
  payTo: Hex;
  resource: string;    // "GET /summary"
  maxTimeoutSeconds: number;
  description?: string;
}

/** EIP-3009 TransferWithAuthorization: the part the buyer actually signs. */
export interface Authorization {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;          // one-time number: the chain accepts it once
}

/** What the buyer sends back. Note: `accepted` (incl. resource) is NOT signed. */
export interface PaymentPayload {
  x402Version: 2;
  accepted: PaymentRequirements;
  payload: { signature: Hex; authorization: Authorization };
  extensions?: { "payment-identifier"?: { id: string } };
}

export interface Asset { address: Hex; name: string; symbol: string }

export const NETWORK = { id: "eip155:84532", chainId: 84532 } as const;
export const USDC: Asset = { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", symbol: "USDC" };
export const EURC: Asset = { address: ("0x" + "0".repeat(36) + "e0c0") as Hex, name: "EURC", symbol: "EURC" };

export const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const domainFor = (asset: Asset, chainId: number) =>
  ({ name: asset.name, version: "2", chainId, verifyingContract: asset.address }) as const;

export const typedMessage = (a: Authorization) => ({
  from: a.from, to: a.to, value: BigInt(a.value),
  validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce,
});

// ---------- small helpers ----------
export const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
export const decode = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;

/** One signed authorization = one key. Used to count deliveries and settlements per payment. */
export const authKey = (p: PaymentPayload) =>
  `${p.payload.authorization.from.toLowerCase()}:${p.payload.authorization.nonce}`;

export const atomic = (dollars: number) => String(Math.round(dollars * 1e6));
export const usd = (a: string | bigint) => `$${(Number(a) / 1e6).toFixed(2)}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const short = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const randomNonce = (): Hex =>
  ("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")) as Hex;
