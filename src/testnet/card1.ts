// TESTNET DEMO · Card 1 (price manipulation) on Base Sepolia, with the official x402 SDK.
//   npx tsx src/testnet/card1.ts                     bait: listed $0.05, the 402 asks $0.50
//   npx tsx src/testnet/card1.ts --quote payto       same price, different wallet
//   npx tsx src/testnet/card1.ts --quote fatfinger   $5.00: the SDK's own $1 cap should stop this one
//   npx tsx src/testnet/card1.ts --agent llm         a model decides whether to pay (before the guard)
//   npx tsx src/testnet/card1.ts --dry-run           offline wiring test, no chain
//
// Run 1: SDK defaults, no guard.  Run 2: same, plus your guard in onBeforePaymentCreation.

import { colors as C } from "../shared/log.js";
import { Guard } from "../buyer/guard.js";
import { Agent, type AgentKind } from "../buyer/agent.js";
import { atomic, short, sleep, newId } from "../shared/types.js";
import { startOfficialSeller, type TestnetQuote } from "./seller.js";
import { officialBuyer } from "./buyer.js";
import { TESTNET } from "./env.js";
import { setup, opt, usd, link } from "./common.js";

const quote = opt("quote", "bait") as TestnetQuote;
const agentKind = opt("agent", "autopay") as AgentKind;
const pause = Number(opt("pause", "900"));
const say = (s = "") => console.log(s);

const env = await setup("card1");
const seller = await startOfficialSeller({ payTo: env.sellerAddress, attacker: env.attacker, facilitatorUrl: env.facilitatorUrl, quote });
const offer = { resource: "GET /lookup", scheme: "exact", amount: atomic(0.05), asset: TESTNET.usdc, network: TESTNET.network, payTo: env.sellerAddress };
const agent = new Agent(agentKind);

async function run(title: string, guard?: Guard) {
  say(`\n${C.bold}${title}${C.reset}`);
  env.startRun(title, { quote, agent: agentKind, guard: guard ? "on" : "off", sdkSpendControls: "default ($1 cap)" });
  say(`① Agent picked "Filings lookup": ${usd(offer.amount)} to ${short(offer.payTo)} (USDC). Saved as the expected offer.`);
  await sleep(pause);
  const before = await env.balance(env.buyer);
  const buy = officialBuyer({
    key: env.buyerKey, taskId: newId("task"), guard, offer,
    approve: agentKind === "autopay" ? undefined : async (req, pid) => {
      say(`② Seller's 402 asks ${usd(req.amount)} to ${short(req.payTo)}`);
      return agent.approvePayment("Get the latest 10-Q filing data for ACME.", req, pid, { price: offer.amount, payTo: offer.payTo, asset: offer.asset });
    },
  });
  let r = await buy(`${seller.url}/lookup`);
  if (r.status === 402) {
    say(`   ${C.yellow}First try failed${C.reset} (${r.error}). Retrying once.`);
    await sleep(3000);
    r = await buy(`${seller.url}/lookup`);
  }
  const after = await env.balance(env.buyer);
  if (r.status === 200) {
    say(`   ${C.green}200 OK${C.reset}  data delivered.  ${r.tx ? (/^0xd+$/.test(r.tx) ? "Settled (dry run)." : "Settled on Base Sepolia.") : ""}`);
    if (r.tx) say(`   ${C.dim}${link(r.tx)}${C.reset}`);
    if (before > 0n) say(`   Buyer balance: ${usd(before)} → ${usd(after)}  (spent ${usd(before - after)})`);
    if (quote !== "honest") say(`   ${C.red}${C.bold}Settled is not correct:${C.reset} expected ${usd(offer.amount)} to ${short(offer.payTo)}.`);
  } else if (r.blocked?.startsWith("guard")) say(`\n   ${C.red}${C.bold}BLOCKED BY GUARD${C.reset}  ${r.blocked.slice(7)}\n   Nothing was signed. Nothing reached the facilitator or the chain.`);
  else if (r.blocked?.startsWith("SDK")) say(`\n   ${C.yellow}${C.bold}BLOCKED BY THE SDK'S DEFAULT CAP${C.reset}  over the official client's $1 per-payment limit (spendControls)`);
  else if (r.blocked) say(`\n   ${C.yellow}${C.bold}AGENT DECLINED${C.reset}`);
  else say(`\n   ${C.red}Error:${C.reset} ${r.error ?? `HTTP ${r.status}`}`);
}

await run("RUN 1 · SDK defaults, no guard");
await sleep(pause);
await run("RUN 2 · SDK defaults + guard", new Guard({ matchOffer: true, capPerCall: BigInt(atomic(0.10)), taskBudget: BigInt(atomic(0.20)) }));
await seller.close();
await env.finish("Card 1 on testnet");
process.exit(0);
