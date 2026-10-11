// OBSERVABILITY SERVER: serves the dashboard and the raw results. No database, no cloud:
// it reads the same files the benchmark writes, so it also works offline at a venue.
//
//   npx tsx src/observe/server.ts      then open http://localhost:4402

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve("results");
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard.html");
const PORT = Number(process.env.PORT ?? 4402);

const readJson = (f: string) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const readLines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const dirs = () => (fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory()) : []);
const safe = (d: string | null) => (d && dirs().includes(d) ? path.join(ROOT, d) : null);

function newest() {
  return dirs().map((d) => ({ d, t: fs.statSync(path.join(ROOT, d, "events.jsonl"), { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
    .sort((a, b) => b.t - a.t)[0]?.d;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (v: unknown) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); };

  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(fs.readFileSync(PAGE)); }

  if (url.pathname === "/api/where") return json({ results: ROOT, runs: dirs().length });

  if (url.pathname === "/api/runs")
    return json(dirs().sort().reverse().map((d) => ({ dir: d, meta: readJson(path.join(ROOT, d, "meta.json")), hasSummary: fs.existsSync(path.join(ROOT, d, "summary.json")) })));

  if (url.pathname === "/api/summary") {
    const d = safe(url.searchParams.get("dir"));
    if (!d) return json(null);
    return json({ summary: readJson(path.join(d, "summary.json")), invariants: readJson(path.join(d, "invariants.json")), meta: readJson(path.join(d, "meta.json")) });
  }

  if (url.pathname === "/api/events") {
    const d = safe(url.searchParams.get("dir"));
    if (!d) return json([]);
    const runId = url.searchParams.get("runId"), round = url.searchParams.get("round");
    return json(readLines(path.join(d, "events.jsonl")).filter((e) => (!runId || e.runId === runId) && (round === null || String(e.round) === round)));
  }

  if (url.pathname === "/api/scoreboard") return json(readJson(path.join(ROOT, "scoreboard.json")) ?? {});

  if (url.pathname === "/api/live") {
    const d = newest();
    if (!d) return json({ dir: null, events: [] });
    const all = readLines(path.join(ROOT, d, "events.jsonl"));
    return json({ dir: d, total: all.length, events: all.slice(-60) });
  }

  res.writeHead(404); res.end();
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use: another dashboard server is probably still running (maybe from another folder).`);
    console.error(`Stop it with:   kill $(lsof -ti :${PORT})`);
    console.error(`or use another port:   PORT=4403 npx tsx src/observe/server.ts\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log(`x402 lab dashboard → http://localhost:${PORT}`);
  console.log(`reading results from: ${ROOT}  (${dirs().length} runs)`);
});
