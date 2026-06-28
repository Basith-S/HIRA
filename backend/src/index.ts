// ─────────────────────────────────────────────────────────────
// Express Server Entry Point — SENTRI Backend (Phase 4)
//
// Boot order:
//   1. Load .env
//   2. Init ChromaDB vector store
//   3. Mount API routes
//   4. Listen
// ─────────────────────────────────────────────────────────────

import path from "path";
import dotenv from "dotenv";
// Load .env relative to this file's location
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import { initVectorStore } from "./memory/vectorStore";
import { TOKEN_BUDGET } from "./cascade/modelRouter";
import analyzeRouter from "./routes/analyze";
import memoryRouter from "./routes/memory";

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    memory: "chroma_connected",
    phases: [1, 2, 3, 4, 5],
    version: "0.5.0",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    memory: "chroma_connected",
    phases: [1, 2, 3, 4, 5],
    version: "0.5.0",
  });
});

// ── CascadeFlow status ────────────────────────────────────────

app.get("/api/cascade/status", (_req, res) => {
  res.json({
    engine: "CascadeFlow",
    phase: 4,
    status: "active",
    tokenBudget: TOKEN_BUDGET,
    description:
      "CascadeFlow Routing Engine — scores complexity, routes to fast/escalation/degraded model path, and appends a structured audit trail to every /api/analyze response.",
    paths: {
      fast_path: "llama-3-8b (simulated) — low/medium complexity, ≤8k tokens",
      escalation_path: "gpt-4o (simulated) — high complexity or composite attack",
      degraded_fallback: "rule-based memory lookup — token budget exceeded",
    },
  });
});

// ── Routes ────────────────────────────────────────────────────

app.use("/api/analyze", analyzeRouter);
app.use("/api/memory", memoryRouter);

// ── Startup ───────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log("[SENTRI] Initializing vector store…");
  await initVectorStore();

  app.listen(PORT, () => {
    console.log(`[SENTRI] Backend running on http://localhost:${PORT}`);
    console.log(`[SENTRI] Phase 4 — CascadeFlow routing engine active`);
    console.log(`[SENTRI]   POST  /api/analyze`);
    console.log(`[SENTRI]   GET   /api/memory/recall?type=&severity=`);
    console.log(`[SENTRI]   POST  /api/memory/reset`);
    console.log(`[SENTRI]   GET   /api/cascade/status`);
    console.log(`[SENTRI]   GET   /health`);
  });
}

bootstrap().catch((err) => {
  console.error("[SENTRI] Fatal startup error:", err);
  process.exit(1);
});
