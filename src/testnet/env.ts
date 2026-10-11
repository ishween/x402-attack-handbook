// TESTNET SETTINGS. Reads .env from the project folder (never commit it: it holds your test key).
//   BUYER_KEY=0x...        testnet-only buyer key (fund it with test USDC from faucet.circle.com)
//   SELLER_ADDRESS=0x...   address that receives payments (no key needed here)
//   ATTACKER_ADDRESS=0x... optional: where the "wrong wallet" trick sends money (defaults to SELLER_ADDRESS's twin below)
//   FACILITATOR_URL=...    optional, default https://x402.org/facilitator
//   RPC_URL=...            optional, default https://sepolia.base.org

import fs from "node:fs";
import type { Hex } from "../shared/types.js";

export function loadEnv(file = ".env") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*([^#\s]+)/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const TESTNET = {
  network: "eip155:84532" as const,
  chainId: 84532,
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex,
  explorer: (tx: string) => `https://sepolia.basescan.org/tx/${tx}`,
  rpc: () => process.env.RPC_URL ?? "https://sepolia.base.org",
  facilitator: () => process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
};

export function need(name: string): Hex {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]+$/.test(v)) {
    console.error(`\nMissing ${name} in .env. See src/testnet/env.ts for what to put there.\n`);
    process.exit(1);
  }
  return v as Hex;
}
