# SENTRI / HIRA — Incident Analysis & Response System

SENTRI is a proof-of-concept security incident analysis system. You paste raw, unstructured
input — log lines, a source file, a packet summary, an email — and it decides whether that
input represents a threat, what kind, how severe, and what to do about it. It then remembers
the incident so later inputs can be judged against what it has already seen.

Its purpose is comparative: it runs a naive baseline analyst pipeline alongside a
memory-informed pipeline, so you can see what vector memory and conditional model routing
actually buy you.

---

## What it does

A submission to `POST /api/analyze` flows through this pipeline:

1. **Recall** — the input is embedded and used to query past incidents from the vector store,
   so prior context is available before any classification happens.
2. **Intake classification** — a small local model (`sentri-classifier`) decides `isThreat`,
   a threat type, a severity, and whether the case warrants escalation. Clean or low-risk
   inputs stop here on the fast path.
3. **Deep forensic analysis** — only if the classifier escalates, a larger local model
   (`sentri-analyzer`) reconstructs the attack chain, estimates a CVSS score, and produces a
   full mitigation plan.
4. **Pattern matching** — the classification is compared against recalled incidents. A
   cross-session composite pattern can override the single-shot verdict.
5. **Decision + persistence** — a structured `AgentDecision` is returned with an audit trail,
   and the incident is written back to memory for future recall.

The response carries the classification, the decision, the similar incidents that informed
it, and a CascadeFlow audit block showing which model path was taken and why.

---

## What it uses

| Component | Role | Required? |
| :--- | :--- | :--- |
| **Node.js 18+** | Runtime for both backend and frontend | **Required** |
| **Ollama** | Runs both local models. No API key, no data leaves the machine | **Required** |
| **Express + TypeScript** | Backend orchestrator, `backend/` | **Required** |
| **React + Vite** | Frontend dashboard, retro CRT theme with light/dark modes | **Required** |
| **Voyage AI** | Cloud embedding API (`voyage-3`) for vector search | **Required for memory** |
| **ChromaDB** (via Docker) | Persistent vector store for incident memory | Optional — degrades |
| **Rust toolchain** | Only to build the native Tauri desktop app | Optional |

### Local models

| Model | Base | Size | Role |
| :--- | :--- | :--- | :--- |
| `sentri-classifier` | phi3:mini (3.8B) | ~2.3 GB | Intake classification, threat/severity call, fast mitigations |
| `sentri-analyzer` | mistral:7b (7B) | ~4.1 GB | Deep forensic analysis, attack chain, CVSS estimation |

Both are built from Modelfiles in `backend/ollama/` and run entirely locally.

### What happens when a dependency is missing

The backend is written to start and keep serving even when its dependencies are not all up:

- **Ollama down or models not built** — the server still starts and logs a warning.
  `/api/health` reports `degraded` with the missing models named. Analysis will not produce
  useful classifications until Ollama is running.
- **ChromaDB down** — recall and persistence fail non-fatally and the system falls back to a
  small in-process memory of recent incidents. It retries the connection lazily (at most once
  every 15 s), so starting Chroma later is picked up without restarting the backend.
- **Voyage rate-limited or unreachable** — embeddings fail after a retry-with-backoff
  sequence. Persistence is best-effort and does not block the response; recall does block,
  since its results feed the classifier. See *Known limitations* below.

---

## Prerequisites

- **Node.js** v18 or higher
- **Ollama** — https://ollama.ai/download
- **Docker & Docker Compose** — only needed for ChromaDB
- **A Voyage AI API key** — https://dash.voyageai.com/
- **Rust toolchain** — only for the native desktop build, via [rustup.rs](https://rustup.rs/)

---

## Environment configuration

From the `backend/` directory, copy the example file and fill it in:

```bash
cp .env.example .env
```

| Variable | Description | Required / Default |
| :--- | :--- | :--- |
| `VOYAGE_API_KEY` | Voyage AI key for embeddings | **Required** |
| `OLLAMA_URL` | Ollama REST endpoint | `http://localhost:11434` |
| `CHROMA_URL` | ChromaDB endpoint | `http://localhost:8000` |
| `PORT` | Express server port | `3001` |
| `OLLAMA_TIMEOUT_MS` | Per-request timeout for a model call. Must cover cold model loads, not just generation | `120000` |
| `OLLAMA_KEEP_ALIVE` | How long Ollama holds a model resident after use. Longer keeps requests fast; costs RAM | `30m` |

---

## Running the project

### Option A: local development (recommended)

**1. Start ChromaDB** from `backend/`:

```bash
docker compose up chromadb -d
```

> Start only `chromadb`. The compose file also defines a `backend` service bound to port
> 3001, which will collide with the dev server you are about to run.

**2. Build the Ollama models** (~8 GB download, one time). Run this from the **repository
root** — the script resolves paths relative to the root:

```bash
npm run setup:models
```

**3. Start the backend** from `backend/`:

```bash
npm install
npm run dev
```

Serves on `http://localhost:3001` (or your `PORT`).

**4. Start the frontend** from the repository root, in a new terminal:

```bash
npm install
npm run dev
```

Available at [http://localhost:1420](http://localhost:1420). For the native desktop build
instead (requires Rust): `npm run tauri dev`.

### Option B: full Docker Compose

Spins up ChromaDB and the backend together. From `backend/`:

```bash
docker compose up --build -d
```

Then run the frontend from the repository root with `npm install && npm run dev`.

---

## CLI tools

Both run from `backend/`.

**Validation suite** — runs pre-configured incident traces through both the baseline and the
full pipeline and prints a comparison:

```bash
npm run validate
```

**Interactive simulator** — generate incidents and watch the cascade evaluate them:

```bash
npm run simulate
```

---

## System design

- **CascadeFlow routing** — the two-tier cascade exists so that the 7B analyzer only runs on
  inputs that warrant it. Clean files and low-severity anomalies exit after the 3.8B
  classifier, which is several times faster.
- **Hindsight memory** — resolved incidents are embedded and indexed, carrying their threat
  type and severity. Later alerts query this history to build context and to detect composite
  patterns that span sessions, which a single-shot classifier cannot see.
- **Graceful degradation** — no single dependency being down takes the server with it. See
  the table above for per-dependency behavior.

---

## Known limitations

These are measured characteristics of the current build, not aspirations:

- **Not air-gapped.** Inference is fully local, but `VOYAGE_API_KEY` is required and every
  store and recall makes an outbound call to Voyage AI. The system cannot build or query
  memory offline. Only the model inference is local.
- **Voyage free-tier rate limits are a real bottleneck.** The free tier allows 3 requests per
  minute. The embedder retries with exponential backoff (5s → 10s → 20s → 40s), but this
  mitigates the limit rather than removing it: requests can still exhaust all retries and
  fail with a 429. When backoff is hit, it adds up to ~75 s to a request, because the recall
  embedding is on the critical path.
- **Inference is slower than a GPU machine suggests.** Measured on CPU-only hardware: a cold
  model load can exceed 30 s, and a warm `sentri-analyzer` call runs 13–46 s — not the 2–5 s
  a small model might imply. `OLLAMA_KEEP_ALIVE` keeps models resident so only the first
  request pays the load cost. End-to-end, an escalated request completes in roughly 17 s when
  Voyage is not rate-limiting, and 60 s+ when it is.
- **The reported latency saving is not meaningful yet.** The audit block computes its
  "vs always-deep" figure against a hardcoded 2200 ms baseline (`ANALYZER_AVG_MS`) that does
  not match observed analyzer latency, so it almost always reports zero saving. The
  conditional routing does save real time; this particular metric does not measure it.
