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

// Chroma may come up after the backend does (Docker started later). Retry the
// connection lazily rather than staying dead until a server restart, but
// throttle it so every request doesn't pay a connection timeout while it's down.
const RECONNECT_INTERVAL_MS = 15_000;
let lastConnectAttempt = 0;

// ── Initialization ────────────────────────────────────────────

/**
 * Connect to the local ChromaDB instance and create (or get) the
 * `sentri_incidents` collection.  Call this once at server startup.
 *
 * Uses CHROMA_URL env var (default: http://localhost:8000).
 */
export async function initVectorStore(): Promise<void> {
  const chromaUrl = process.env.CHROMA_URL ?? "http://localhost:8000";
  lastConnectAttempt = Date.now();

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
    // ensureCollection() will retry on later requests.
    collection = null;
  }
}

// ── Health ────────────────────────────────────────────────────

/**
 * Probe ChromaDB for real. Attempts a lazy reconnect if the collection is not
 * currently held, so a Chroma instance started after the backend is picked up.
 */
export async function checkChromaHealth(): Promise<{
  online: boolean;
  documentCount: number | null;
}> {
  const col = await ensureCollection();
  if (!col) return { online: false, documentCount: null };

  try {
    return { online: true, documentCount: await col.count() };
  } catch {
    // Connection died between the reconnect and the count.
    collection = null;
    return { online: false, documentCount: null };
  }
}

// ── Guard helpers ─────────────────────────────────────────────

/**
 * Return the live collection, retrying the connection at most once per
 * RECONNECT_INTERVAL_MS. Returns null when ChromaDB is still unreachable.
 */
async function ensureCollection(): Promise<Collection | null> {
  if (collection) return collection;
  if (Date.now() - lastConnectAttempt < RECONNECT_INTERVAL_MS) return null;

  await initVectorStore();
  return collection;
}

async function requireCollection(): Promise<Collection> {
  const col = await ensureCollection();
  if (!col) {
    throw new Error(
      "[VectorStore] ChromaDB unreachable. Start it with: docker-compose up -d"
    );
  }
  return col;
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
  const col = await requireCollection();

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
  const col = await requireCollection();

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

/**
 * Delete and re-create the sentri_incidents collection.
 */
export async function resetVectorStore(): Promise<void> {
  if (!client) {
    throw new Error("[VectorStore] Cannot reset — client not initialized.");
  }
  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
    collection = null;
    await initVectorStore();
    console.log(`[VectorStore] Collection "${COLLECTION_NAME}" deleted and re-created.`);
  } catch (err) {
    console.error("[VectorStore] Reset collection failed:", err);
    throw err;
  }
}
