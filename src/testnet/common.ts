// Shared start-up for the testnet demos: settings, safety checks, logging, and the dashboard summary.

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, erc20Abi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { openLog, closeLog, setRound, colors as C } from "../shared/log.js";
import type { Hex } from "../shared/types.js";
import { TESTNET, loadEnv, need } from "./env.js";
import { startDryFacilitator } from "./dry-facilitator.js";

export const args = process.argv.slice(2);
export const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
export const dry = args.includes("--dry-run");

export async function setup(name: string) {
  loadEnv();
  let facilitatorUrl = TESTNET.facilitator(), stopDry: (() => Promise<unknown>) | undefined;
  let buyerKey: Hex, sellerAddress: Hex, attacker: Hex;

  if (dry) {
    const f = await startDryFacilitator();
    facilitatorUrl = f.url; stopDry = f.close;
    buyerKey = generatePrivateKey();
    sellerAddress = privateKeyToAccount(generatePrivateKey()).address;
    attacker = privateKeyToAccount(generatePrivateKey()).address;
    console.log(`${C.yellow}DRY RUN: local stand-in facilitator, no chain, no money. Wiring test only.${C.reset}`);
  } else {
    buyerKey = need("BUYER_KEY");
    sellerAddress = need("SELLER_ADDRESS");
    attacker = (process.env.ATTACKER_ADDRESS as Hex) ?? privateKeyToAccount(("0x" + "ad".repeat(32)) as Hex).address;
  }
  const buyer = privateKeyToAccount(buyerKey).address;
  const chain = createPublicClient({ chain: baseSepolia, transport: http(TESTNET.rpc()) });

  const balance = async (who: Hex) => (dry ? 0n : await chain.readContract({ address: TESTNET.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] }));

  if (!dry) {
    const id = await chain.getChainId();
    if (id !== TESTNET.chainId) { console.error(`Wrong chain: ${id}. Expected Base Sepolia (${TESTNET.chainId}). Stopping.`); process.exit(1); }
    const b = await balance(buyer);
    console.log(`${C.dim}Base Sepolia · facilitator ${facilitatorUrl}\nbuyer ${buyer}: ${(Number(b) / 1e6).toFixed(2)} test USDC${C.reset}`);
    if (b < 1_000_000n) { console.error(`\nBuyer has under 1 test USDC. Get some at faucet.circle.com (Base Sepolia, USDC) for ${buyer}.\n`); process.exit(1); }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join("results", `${dry ? "dryrun" : "testnet"}-${name}-${stamp}`);
  openLog(dir, `testnet-${name}`);
  const runs: { runId: string; config: Record<string, unknown> }[] = [];

  return {
    facilitatorUrl, buyerKey, buyer, sellerAddress, attacker, balance, dir,
    startRun(runId: string, config: Record<string, unknown>) { runs.push({ runId, config }); setRound(runId, 0); },
    async finish(title: string) {
      await closeLog();
      fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ card: name, title, dir: path.basename(dir), runs: runs.map((r) => ({ experiment: "testnet", ...r, n: 1, k: 0, rate: 0, lo: 0, hi: 0, metrics: {} })) }, null, 2));
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ card: name, title, started: new Date().toISOString(), chain: dry ? "dry run (no chain)" : "Base Sepolia (public testnet)", facilitator: facilitatorUrl, sdk: "@x402/* 2.28.0", args }, null, 2));
      await stopDry?.();
      console.log(`${C.dim}→ ${dir}  (open the dashboard's Trace tab to inspect it)${C.reset}\n`);
    },
  };
}

export const usd = (a: bigint | string) => `$${(Number(a) / 1e6).toFixed(2)}`;
export const link = (tx?: string) => (tx && !/^0xd+$/.test(tx) ? TESTNET.explorer(tx) : tx ? "(dry run: no real transaction)" : "");
