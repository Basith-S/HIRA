// ─────────────────────────────────────────────────────────────
// Task 1 — JSON Incident Logger
//
// Persists resolved MemoryArtifacts to backend/memory/incidents.json
// as a flat JSON array.  Designed to be safe for concurrent reads
// (no concurrent write locking needed in Phase 2 single-process mode).
// ─────────────────────────────────────────────────────────────

import fs from "fs/promises";
import path from "path";
import type { MemoryArtifact } from "../types/memory";

// Resolved path: <repo-root>/backend/memory/incidents.json
const INCIDENTS_FILE = path.resolve(__dirname, "../../memory/incidents.json");

/**
 * Ensure the parent directory exists before any read/write operation.
 */
async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(INCIDENTS_FILE), { recursive: true });
}

/**
 * Load all persisted incidents from the JSON log.
 * Returns an empty array if the file does not exist yet.
 */
export async function loadAllIncidents(): Promise<MemoryArtifact[]> {
  await ensureDir();

  try {
    const raw = await fs.readFile(INCIDENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[IncidentLogger] incidents.json contained non-array data — resetting.");
      return [];
    }
    return parsed as MemoryArtifact[];
  } catch (err: unknown) {
    // ENOENT → first run; any other parse error → treat as empty
    if (isNodeError(err) && err.code === "ENOENT") {
      return [];
    }
    console.error("[IncidentLogger] Failed to parse incidents.json:", err);
    return [];
  }
}

/**
 * Append a resolved MemoryArtifact to the JSON log.
 * Reads the current file, pushes the new entry, then writes the
 * entire array back atomically (write-then-rename is overkill here;
 * full-file write is acceptable for Phase 2 scale).
 */
export async function logIncident(artifact: MemoryArtifact): Promise<void> {
  await ensureDir();

  const existing = await loadAllIncidents();
  existing.push(artifact);

  await fs.writeFile(INCIDENTS_FILE, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`[IncidentLogger] Logged incident ${artifact.incident_id} → ${INCIDENTS_FILE}`);
}

// ── Utility ──────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * Clear the JSON incident log.
 */
export async function resetIncidentsLog(): Promise<void> {
  await ensureDir();
  try {
    await fs.writeFile(INCIDENTS_FILE, "[]", "utf-8");
    console.log(`[IncidentLogger] Cleared incidents log → ${INCIDENTS_FILE}`);
  } catch (err) {
    console.error("[IncidentLogger] Failed to clear incidents log:", err);
    throw err;
  }
}
