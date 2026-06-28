import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { DEMO_SESSIONS, runDemoSession } from "../src/demo/sessionScript";

const SEPARATOR = "─".repeat(60);

const SESSION_LABELS = [
  "DDoS Probe",
  "Baseline Noise (Control)",
  "Credential Stuffing",
  "Composite Trigger — The Delta Moment ⚡",
  "Token Anomaly (Post-Chain Validation)",
];

const BACKEND_URL = process.env["BACKEND_URL"] ?? "http://localhost:3001";

/**
 * Poll /health until the backend is responding or timeout is reached.
 * Prevents "fetch failed" when nodemon is still compiling on startup.
 */
async function waitForBackend(
  timeoutMs = 15_000,
  intervalMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("  Waiting for backend");
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.ok) {
        console.log(" ✓\n");
        return;
      }
    } catch {
      // still starting
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log(" ✗");
  throw new Error(
    `Backend at ${BACKEND_URL} did not respond within ${timeoutMs / 1000}s. ` +
      "Run `npm run dev` in another terminal first."
  );
}

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("  SENTRI — Phase 3 Hindsight Demo");
  console.log("  Composite Pattern Detection Proof-of-Concept");
  console.log("═".repeat(60));
  console.log(`\n  Sessions to run: ${DEMO_SESSIONS.length}`);
  console.log("  Backend: " + BACKEND_URL);
  console.log("");

  await waitForBackend();

  for (let i = 0; i < DEMO_SESSIONS.length; i++) {
    const label = SESSION_LABELS[i] ?? `Session ${i + 1}`;
    console.log(`\n=== SESSION ${i + 1}: ${label.toUpperCase()} ===\n`);

    try {
      await runDemoSession(i);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Session ${i + 1} failed: ${message}`);
    }

    console.log("\n" + SEPARATOR);
  }

  console.log("\n✅ Demo complete.\n");
}

main().catch((err) => {
  console.error("Fatal demo error:", err);
  process.exit(1);
});
