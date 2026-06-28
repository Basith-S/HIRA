// ─────────────────────────────────────────────────────────────
// Task 3 — ChromaDB Vector Store Integration
//
// Manages a single ChromaDB collection ("sentri_incidents").
// initVectorStore() must be called once at Express server startup
// before any upsert or query operations.
// ─────────────────────────────────────────────────────────────

import { ChromaClient, Collection } from "chromadb";
import type { SimilarIncident } from "../types/memory";

const COLLECTION_NAME = "sentri_incidents";

// Singleton client and collection — initialized once via initVectorStore()
let client: ChromaClient | null = null;
let collection: Collection | null = null;

// ── Initialization ────────────────────────────────────────────

/**
 * Connect to the local ChromaDB instance and create (or get) the
 * `sentri_incidents` collection.  Call this once at server startup.
 *
 * Uses CHROMA_URL env var (default: http://localhost:8000).
 */
export async function initVectorStore(): Promise<void> {
  const chromaUrl = process.env.CHROMA_URL ?? "http://localhost:8000";

  try {
    client = new ChromaClient({ path: chromaUrl });

    // getOrCreateCollection is idempotent — safe to call on every restart
    collection = await client.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: {
        description: "SENTRI/HIRA incident embeddings for Hindsight memory",
        "hnsw:space": "cosine",
      },
    });

    const count = await collection.count();
    console.log(
      `[VectorStore] Connected to ChromaDB at ${chromaUrl}. ` +
        `Collection "${COLLECTION_NAME}" has ${count} document(s).`
    );
  } catch (err) {
    console.error(
      "[VectorStore] Failed to connect to ChromaDB. " +
        "Make sure Docker is running: `docker-compose up -d`",
      err
    );
    // Do not throw — allow the server to start even if ChromaDB is down;
    // individual operations will throw when collection is null.
  }
}

// ── Guard helper ──────────────────────────────────────────────

function requireCollection(): Collection {
  if (!collection) {
    throw new Error(
      "[VectorStore] Collection not initialized. Did initVectorStore() run?"
    );
  }
  return collection;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Insert or update an incident embedding in ChromaDB.
 *
 * @param id        - Unique document ID (incident_id / embedding_id)
 * @param embedding - The embedding vector (number[])
 * @param metadata  - Flat key→value metadata stored alongside the vector
 */
export async function upsertIncident(
  id: string,
  embedding: number[],
  metadata: Record<string, string>
): Promise<void> {
  const col = requireCollection();

  await col.upsert({
    ids: [id],
    embeddings: [embedding],
    metadatas: [metadata],
    documents: [metadata["summary"] ?? id],
  });

  console.log(`[VectorStore] Upserted incident ${id} into "${COLLECTION_NAME}".`);
}

/**
 * Find the most similar past incidents to a query embedding.
 *
 * @param embedding - Query vector
 * @param nResults  - How many results to return (default: 3)
 * @returns         Array of SimilarIncident ordered by ascending distance
 */
export async function querySimilar(
  embedding: number[],
  nResults: number = 3
): Promise<SimilarIncident[]> {
  const col = requireCollection();

  const count = await col.count();
  if (count === 0) {
    // Collection is empty — return early to avoid ChromaDB error
    return [];
  }

  const safeN = Math.min(nResults, count);

  const result = await col.query({
    queryEmbeddings: [embedding],
    nResults: safeN,
    include: ["metadatas", "distances"] as any,
  });

  const ids = result.ids[0] ?? [];
  const distances = result.distances?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];

  return ids.map((id, i) => ({
    id,
    distance: distances[i] ?? 0,
    metadata: (metadatas[i] as Record<string, string>) ?? {},
  }));
}
