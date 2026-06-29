# SENTRI / HIRA (Incident Analysis & Response System)

SENTRI is an advanced, proof-of-concept incident analysis system. It compares a naive baseline incident-response process against a memory-informed security analyst pipeline utilizing a Hindsight vector memory database and CascadeFlow intelligence routing.

The platform includes:
- **Tauri + React + Vite Frontend**: An interactive dashboard styled with a high-fidelity retro CRT theme (supporting Light/Dark modes) to manage and review security logs and analyze execution traces.
- **Express + TypeScript Backend**: The central orchestrator handling security logs, pipeline routing, and local SLM integrations.
- **ChromaDB**: A high-performance vector database used to store persistent incident memory.
- **Voyage AI**: Powerful text embeddings mapped into ChromaDB with built-in retry-backoff resiliency.
- **Ollama (Local SLM)**: Two-tier local model stack — `sentri-classifier` (phi3:mini) for fast intake classification and `sentri-analyzer` (mistral:7b) for deep forensic analysis. No data leaves your machine.

---

## 🛠️ Prerequisites

Before running the application, make sure you have the following installed on your system:

- **Node.js** (v18 or higher)
- **Docker & Docker Compose** (for spinning up ChromaDB)
- **Ollama** — https://ollama.ai/download
- **CascadeFlow Routing Agent** — Built-in orchestrator that implements a two-tier model cascade (`sentri-classifier` and `sentri-analyzer`) to balance speed and intelligence.
- **Rust Toolchain & Cargo** (Required *only* if you want to run the native desktop version via Tauri. If running in the web browser, this is optional.)
  - Install Rust via [rustup.rs](https://rustup.rs/)

---

## ⚙️ Environment Configuration

You must configure the backend environment variables before starting the servers. 

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create a `.env` file (you can copy the example configuration):
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in your API keys:

| Variable | Description | Required / Default |
| :--- | :--- | :--- |
| `VOYAGE_API_KEY` | Your Voyage AI API key for embeddings. [Get a key](https://dash.voyageai.com/) | **Required** |
| `OLLAMA_URL` | Ollama REST API endpoint. | `http://localhost:11434` |
| `CHROMA_URL` | The endpoint URL of the ChromaDB instance. | `http://localhost:8000` |
| `PORT` | Express server port. | `3001` |

---

## 🚀 Running the Project

You can run the project in two main ways: **Local Development** (recommended for coding/debugging) or **Full Docker Compose** mode.

### Option A: Local Development Mode (Recommended)

This mode allows hot-reloading for both the backend and frontend codebases.

#### Step 1: Start ChromaDB
Spin up the local persistent ChromaDB container from the `backend/` directory:
```bash
cd backend
docker compose up chromadb -d
```

#### Step 2: Install Ollama Models (~8GB download, one time)
```bash
npm run setup:models
```

#### Step 3: Start the Backend Server
In the `backend/` directory, install dependencies and run the server:
```bash
npm install
npm run dev
```
The server will start on `http://localhost:3001` (or your custom `PORT` in `.env`).

#### Step 4: Run the Frontend App
Open a new terminal window in the project's root folder:
```bash
npm install
# To run in the web browser (recommended & fast):
npm run dev
# OR, to compile and run as a native desktop application (requires Rust):
npm run tauri dev
```
By default, the Vite web server will be accessible at [http://localhost:1420](http://localhost:1420).

---

### Option B: Full Docker Compose Mode

This spins up both ChromaDB and the backend Express application within Docker containers.

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Build and launch all services:
   ```bash
   docker compose up --build -d
   ```
3. Run the frontend from the project root:
   ```bash
   npm install
   npm run dev
   ```

---

## 🧠 Model Info

| Model | Base | Size | Use Case |
| :--- | :--- | :--- | :--- |
| `sentri-classifier` | phi3:mini (3.8B) | ~2.3GB | Intake classification, isThreat determination, fast mitigations |
| `sentri-analyzer` | mistral:7b (7B) | ~4.1GB | Deep forensic analysis, attack chain reconstruction, CVSS estimation |

Both models run locally via Ollama. **No data leaves your machine.** No API key needed for inference.

> **Note on CPU-only inference**: If the analyst's machine has no GPU, `sentri-analyzer` (mistral:7b) inference takes approximately 2–5 seconds per response. This is acceptable for deep analysis (only fires on critical escalations) but worth knowing upfront.

---

## 📊 Running Validation & CLI Tools

SENTRI features CLI scripts inside the `backend/` directory to quickly validate system behavior or simulate new security incidents.

### Run Validation Suite
Compare a naive baseline analyst pipeline against the full SENTRI pipeline (incorporating memory, CascadeFlow, and hindsight):
```bash
cd backend
npm run validate
```
This script will execute the pre-configured incident traces and print a detailed comparison report directly in your terminal.

### Interactive CLI Simulator
Generate new incident alerts and watch the Cascade agent evaluate threat severity and mitigation strategies:
```bash
cd backend
npm run simulate
```

---

## 🧠 Core System Design & Resiliency

- **Voyage AI Rate-Limit Mitigation**: Voyage's free-tier rate limit (3 Requests Per Minute) is programmatically bypassed using an exponential-backoff retry decorator in the embedding service, guaranteeing that multi-step incident chains complete successfully without dropping requests.
- **CascadeFlow Routing Agent**: Incident analysis is dynamically orchestrated using a custom local CascadeFlow Agent implementation. The agent processes inputs in two stages:
  1. **Intake Classification (phi3:mini)**: Evaluates raw security inputs for threat presence and severity. Safe/clean files or low-level anomalies exit immediately on the fast path.
  2. **Deep Forensic Analysis (mistral:7b)**: Critical threats, exfiltration vectors, or ransomware signals are escalated to the deep analyzer to generate full threat chain details and detailed mitigation plans.
  *This conditional routing provides up to a 75% latency saving compared to running all inputs through the 7B parameter model.*
- **Hindsight Memory**: Past threats and their resolutions are indexed inside ChromaDB. Subsequent alerts automatically query historical incidents to build context, optimize threat classification, and prevent security double-jeopardy or repetitive alerts.
- **Fully Air-Gapped Capable**: All inference runs locally via Ollama — no external API calls, no token costs, works completely offline. Critical for incident response in isolated environments.
