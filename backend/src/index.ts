// ─────────────────────────────────────────────────────────────
// Express Server Entry Point — SENTRI Backend (Phase 2)
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
import analyzeRouter from "./routes/analyze";
import memoryRouter from "./routes/memory";

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", phase: "2", service: "sentri-backend" });
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
    console.log(`[SENTRI] Phase 2 — Hindsight memory subsystem active`);
    console.log(`[SENTRI]   POST  /api/analyze`);
    console.log(`[SENTRI]   GET   /api/memory/recall?type=&severity=`);
    console.log(`[SENTRI]   GET   /health`);
  });
}

bootstrap().catch((err) => {
  console.error("[SENTRI] Fatal startup error:", err);
  process.exit(1);
});
