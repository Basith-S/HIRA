// ─────────────────────────────────────────────────────────────
// Task 4 — Memory Service (Orchestrator)
//
// High-level API that composes the embedder, vector store,
// and incident logger into two clean operations:
//   • storeIncident  — embed + upsert + log
//   • recallSimilar  — embed query + similarity search
// ─────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import { buildSummaryText, generateEmbedding } from "./embedder";
import { upsertIncident, querySimilar } from "./vectorStore";
import { logIncident } from "./incidentLogger";
import type { MemoryArtifact, InputTrigger, SimilarIncident } from "../types/memory";

// ── Store ─────────────────────────────────────────────────────

/**
 * Persist a resolved incident into both ChromaDB and the JSON log.
 *
 * Pipeline:
 *   1. Build canonical summary text from the artifact fields
 *   2. Generate embedding via Voyage AI (voyage-3)
 *   3. Upsert embedding + metadata into ChromaDB
 *   4. Append artifact to incidents.json
 */
export async function storeIncident(artifact: MemoryArtifact): Promise<void> {
  // 1. Build summary text
  const summaryText = buildSummaryText(
    artifact.trigger_type,
    // severity is not stored on MemoryArtifact — derive from vectors if present,
    // otherwise default to 0.5 as a neutral value
    0.5,
    artifact.hindsight_note || `Incident ${artifact.incident_id}`
  );

  // 2. Generate embedding
  const embedding = await generateEmbedding(summaryText);

  // 3. Determine the embedding_id (reuse existing or generate fresh UUID)
  const embeddingId = artifact.embedding_id ?? uuidv4();

  // 4. Upsert into ChromaDB
  const metadata: Record<string, string> = {
    incident_id: artifact.incident_id,
    trigger_type: artifact.trigger_type,
    created_at: artifact.created_at,
    mitigation_success: String(artifact.mitigation_success),
    summary: summaryText,
    embedding_id: embeddingId,
  };

  await upsertIncident(embeddingId, embedding, metadata);

  // 5. Persist to JSON log (with embedding_id back-filled)
  const artifactWithId: MemoryArtifact = { ...artifact, embedding_id: embeddingId };
  await logIncident(artifactWithId);

  console.log(
    `[MemoryService] Stored incident ${artifact.incident_id} ` +
      `(embedding_id: ${embeddingId})`
  );
}

// ── Recall ────────────────────────────────────────────────────

/**
 * Find past incidents similar to an incoming trigger.
 *
 * Pipeline:
 *   1. Build summary text from the trigger
 *   2. Generate embedding
 *   3. Query ChromaDB for the topK nearest neighbors
 *   4. Return results with distance scores
 *
 * @param incoming - The incoming anomaly trigger
 * @param topK     - Number of similar incidents to return (default: 3)
 */
export async function recallSimilar(
  incoming: InputTrigger,
  topK: number = 3
): Promise<SimilarIncident[]> {
  // 1. Build summary text
  const summaryText =
    incoming.summary ??
    buildSummaryText(
      incoming.trigger_type,
      incoming.severity,
      `source:${incoming.source}`
    );

  // 2. Generate embedding for the query
  const embedding = await generateEmbedding(summaryText);

  // 3. Query ChromaDB
  const results = await querySimilar(embedding, topK);

  console.log(
    `[MemoryService] Recall query for trigger "${incoming.trigger_type}" ` +
      `returned ${results.length} result(s).`
  );

  return results;
}

import { resetVectorStore } from "./vectorStore";
import { resetIncidentsLog } from "./incidentLogger";

/**
 * Reset all memory subsystems (ChromaDB + JSON log).
 */
export async function resetMemory(): Promise<void> {
  console.log("[MemoryService] Resetting all memory subsystems…");
  await resetVectorStore();
  await resetIncidentsLog();
  console.log("[MemoryService] Memory subsystems reset complete.");
}
