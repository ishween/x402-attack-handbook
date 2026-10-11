# x402 lab

Six attacks on x402 agent payments, the fix for each, a benchmark that measures both, and a page that shows every step.

Everything runs locally in one Node process: no wallet funding, no network, no API key unless you choose a real model.

```bash
npm install
npx tsx src/bench/run.ts all          # run all six cards (writes results/)
npx tsx src/observe/server.ts         # open http://localhost:4402
npx tsx src/demo/card1-live.ts        # the stage demo for card 1
```

Requires Node 20 or newer.

---

## How the code is split

The four parties from the talk are four folders. One shared part, `shared/`, is used by all of them.

```
src/
  shared/types.ts           payment shapes (x402 v2, simplified), header names, helpers
  shared/log.ts             ONE event log for every party: the source of all charts and traces

  buyer/                    BUYER
    wallet.ts               signs EIP-3009 authorizations (every signature = a new nonce = a new charge)
    client.ts               request → 402 → agent → GUARD → sign → paid retry; retry policies (card 2)
    guard.ts                THE GUARD: plain code before signing. The file to put on slides.
    agent.ts                autopay | gullible | llm: who makes decisions, with logged reasons
    catalog.ts              mock Bazaar listings, and the saved "offer" the guard compares against

  facilitator/              FACILITATOR
    facilitator.ts          verify (strict or signature-only) and settle

  seller/                   SELLER
    seller.ts               x402 paywall; every seller-side fix is a switch
    cache.ts                a tiny shared cache in front of the seller (card 3)

  chain/                    ON-CHAIN
    chain.ts                simulated chain with EIP-3009 rules: nonce once, money moves at mining, reorg

  lab.ts                    the starting world: chain, facilitator, funded buyer, empty wallet, fixed wallets
  cards/card1…card6         one file per card: settings matrix, setup, one round
  bench/                    run.ts (runner), oracle.ts (invariants), analyze.ts (rates, scoreboard)
  observe/                  server.ts + dashboard.html (scoreboard, charts, traces, live view)
  demo/card1-live.ts        narrated two-run demo for the stage
```

### What every card reuses

| Shared part | Used by | Why it matters |
| --- | --- | --- |
| `shared/log.ts` event log | all six | One `purchaseId` joins buyer, seller, facilitator and chain records |
| `chain/chain.ts` | all six | The nonce rule and "money moves at mining" are what cards 2, 3 and 4 hinge on |
| `facilitator/facilitator.ts` | all six | `strict` vs `sig` shows what each verify check buys you |
| `seller/seller.ts` | all six | Switches turn each seller-side fix on and off |
| `buyer/client.ts` | all six | The honest purchase path, with the guard hook in the right place |
| `buyer/guard.ts` | 1, 4, 5, 6 | One guard, a few rules, each rule tied to a card |
| `bench/*` + `observe/*` | all six | Same runner, oracle, analysis and dashboard for every card |

### Where each fix lives

| Card | Attack | Fix | File | Switch or rule |
| --- | --- | --- | --- | --- |
| 1 | Price manipulation | Live 402 must equal the chosen offer; cap; task budget | `buyer/guard.ts` | `matchOffer`, `capPerCall`, `taskBudget` |
| 2 | Burst (seller loses) | Claim each payment once, before any work | `seller/seller.ts` | `dedupe: "shared"` (+ `serveOn: "settle"`) |
| 2 | Timeout (buyer loses) | Resend the same signed payment, never a new one | `buyer/client.ts` | `retry: "same-auth" \| "idempotent"` |
| 3 | Verify is not settle | Deliver only after settlement | `seller/seller.ts` | `serveOn: "settle"` |
| 3 | Side entrance | One gate for every route | `seller/seller.ts` | `singleGate: true` |
| 3 | Shared cache | `private, no-store` plus a bypass rule | `seller/seller.ts`, `seller/cache.ts` | `cacheControl`, cache `bypass-paid` |
| 4 | Swap | Bind each payment to one item | `seller/seller.ts` | `bindResource: true` |
| 4 | Paid but useless | Code checks, then a judge (signal only) | `cards/card4-wrong-item.ts` | `check` |
| 5 | Lookalike seller | Pinned identity; probation for unknown sellers | `buyer/guard.ts` | `allowlist`, `probationCap`, `beforeRequest` |
| 6 | Prompt injection | Approved plan; money only from a 402 | `buyer/guard.ts` | `plan`, `checkDirectPayment` |

---

## Running experiments

```bash
npx tsx src/bench/run.ts card1                        # all experiments in card 1
npx tsx src/bench/run.ts card2 seller --rounds 50     # one experiment, 50 rounds
npx tsx src/bench/run.ts card1 --where guard=C2       # only matching settings
npx tsx src/bench/run.ts card6 --agent llm            # real model (needs ANTHROPIC_API_KEY)
```

Cards 1, 5 and 6 have an agent. `--agent llm` uses a real model, from either provider:

```bash
# Anthropic
export ANTHROPIC_API_KEY=...            # AGENT_MODEL defaults to claude-sonnet-5-5

# Ollama (local, free)
ollama pull llama3.1:8b                 # or qwen2.5:7b, mistral, ...
export AGENT_PROVIDER=ollama            # OLLAMA_URL defaults to http://localhost:11434
export AGENT_MODEL=llama3.1:8b

npx tsx src/bench/run.ts card1 price --agent llm --rounds 30
npx tsx src/demo/card1-live.ts --agent llm
```

`AGENT_TEMPERATURE` defaults to 0.7. The provider and model are written to `meta.json` and to every agent decision in the log.

Each run writes `results/<card>-<time>/`:

| File | What it is |
| --- | --- |
| `events.jsonl` | Every step of every round, from every party. Never edit it. |
| `rounds.jsonl` | One line per round: settings and outcome |
| `invariants.json` | The oracle's independent check of the events |
| `summary.json` | Rate and 95% Wilson interval per setting, plus metric averages |
| `meta.json` | Node version, git commit, chain, model, arguments |

`results/scoreboard.json` collects the newest row for every card: that is the talk slide.

### The oracle

`bench/oracle.ts` rebuilds what happened from `events.jsonl` alone and checks four invariants:

| Invariant | Meaning |
| --- | --- |
| I1 | One delivery per signed payment |
| I2 | One signed payment per purchase |
| I3 | Every delivery has a settlement behind it |
| I4 | No paid content served to an unpaid request |

If a card's own count disagrees with the events, the run reports a mismatch: the test is wrong, not the system.

---

## Public testnet (cards 1 and 6)

`src/testnet/` runs cards 1 and 6 with the **official x402 SDK** (`@x402/fetch`, `@x402/express`, 2.28.0) on **Base Sepolia**, settled by the public facilitator at `https://x402.org/facilitator`. The guard sits in the official client hook `onBeforePaymentCreation`, so a blocked payment is never signed.

Step 1. Make a new wallet for testnet only. Never reuse a wallet that holds real money.

Step 2. Create a file called `.env` in this folder (it is in `.gitignore`, so it will not be committed):

```bash
BUYER_KEY=0x...            # private key of the testnet-only buyer wallet
SELLER_ADDRESS=0x...       # any address you control (receives the test USDC)
# ATTACKER_ADDRESS=0x...   # optional, for --quote payto
# FACILITATOR_URL=https://x402.org/facilitator
# RPC_URL=https://sepolia.base.org
```

Step 3. Get test USDC for the buyer at https://faucet.circle.com (pick Base Sepolia). One dollar covers many runs.

Step 4. Try a dry run first. It uses a local stand-in facilitator and fresh keys, so no network and no money:

```bash
npx tsx src/testnet/card1.ts --dry-run
npx tsx src/testnet/card6.ts --dry-run
```

Step 5. The real runs:

```bash
npx tsx src/testnet/card1.ts                 # bait: $0.05 listed, $0.50 asked
npx tsx src/testnet/card1.ts --quote payto   # right price, attacker wallet
npx tsx src/testnet/card1.ts --quote fatfinger
npx tsx src/testnet/card6.ts                 # injection in the reply (plan first: the agent plans from the task, the plan is locked, then the reply arrives)
npx tsx src/testnet/card6.ts --task "Get the full Q2 report summary."   # a different request makes a different plan
npx tsx src/testnet/card6.ts --agent llm     # same, with a real model deciding
```

Each run prints the balance change and a `sepolia.basescan.org` link for every settled payment, and writes `results/testnet-<card>-<time>/` so the Trace tab can draw it.

What the official client already stops: it has default spend controls, a $1 cap per payment and default assets only. So the `fatfinger` price ($5.00) is blocked by the SDK even with no guard. The $0.50 bait, the attacker wallet, and the budget drain all pass the SDK defaults. Those are what the guard is for.

---

## Other tools

| Command | What it does |
| --- | --- |
| `npx tsx src/bench/quotes.ts [results/dir]` | Takes the newest run with real model decisions and sorts the model's reasons into "wrong and confident", "right for the wrong reason", "right for the real reason". Writes `quotes.md` in that run folder. |
| `npx tsx src/bench/reanalyze.ts` | Rebuilds every `summary.json` and the scoreboard from the saved logs. Use it after changing `analyze.ts`. |

Each scoreboard row also lists the **cost of the full fix**, measured on honest rounds only: how long the guard takes (microseconds), or how much longer a buyer waits when the seller settles before serving. Each cell shows the **money lost per 1,000 attempts**.

---

## Observing

`npx tsx src/observe/server.ts` and open `http://localhost:4402`. It reads the same files, so it works offline at a venue.

| Tab | Shows |
| --- | --- |
| Scoreboard | Every card: no fix, partial fix, full fix. Successful attacks out of rounds, with intervals. |
| Experiments | One run: bar chart per setting (rate or any metric), table, oracle result. Click a row to open its trace. |
| Trace | One round as a sequence diagram, drawn from the event log. The shaded "buyer side" holds the buyer agent and the guard, so you can see the guard runs inside the buyer, before signing. Each guard box shows its verdict and the failing field; click it for the full table of checks (expected, got, pass or fail). A divider marks each new purchase. |
| Live | The newest events, redrawn every second. Keep it on a second screen during the demo. |

For terminal output during any run, set `LIVE=1`.

---

## Honest limits

- **The benchmark chain is simulated.** It follows EIP-3009 rules (signature, expiry, nonce once, balance) but is not a real chain. Only `src/testnet/` (cards 1 and 6) uses the real Base Sepolia chain and the official SDK. Real settlement takes about 2 seconds on Base, much longer than in the lab.
- **Rates are lab results under these settings.** Example: a burst against a naive seller succeeds almost every time here, because local timing is tight. These are local numbers, not real-world rates.
- **`gullible` is a scripted stand-in for a fooled model**, not a measurement of any model. Use `--agent llm` for real numbers, and record the model and temperature.
- **The card 4 judge is a keyword stand-in.** Swap in a model call for real numbers.
- **The payment shapes are simplified x402 v2.** Field names follow the spec, but the benchmark is not the official SDK (the testnet folder is). In the real v2 types, the resource URL and description sit on the 402 itself (`paymentRequired.resource`), not in each payment option.
- **The guard maps onto the official SDK hook** (checked against `@x402/core` 2.28.0): `client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => …)`, returning `{ abort: true, reason }` to stop the payment.
- **Lab keys only.** The fixed keys in `lab.ts` are public. Never fund them on a real network.
