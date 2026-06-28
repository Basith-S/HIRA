# SENTRI / HIRA (Incident Analysis & Response System)

SENTRI is an advanced, proof-of-concept incident analysis system. It compares a naive baseline incident-response process against a memory-informed security analyst pipeline utilizing a Hindsight vector memory database and CascadeFlow intelligence routing.

The platform includes:
- **Tauri + React + Vite Frontend**: An interactive dashboard styled with a high-fidelity retro CRT theme (supporting Light/Dark modes) to manage and review security logs and analyze execution traces.
- **Express + TypeScript Backend**: The central orchestrator handling security logs, pipeline routing, and LLM integrations.
- **ChromaDB**: A high-performance vector database used to store persistent incident memory.
- **Voyage AI**: Powerful text embeddings mapped into ChromaDB with built-in retry-backoff resiliency.
- **Google Gemini (via @cascadeflow/core)**: Powers the intake classifier (using `gemini-1.5-flash`) and the deep analyzer to categorize incidents, assess threat posture, and suggest mitigations.

---

## 🛠️ Prerequisites

Before running the application, make sure you have the following installed on your system:

- **Node.js** (v20 or higher recommended)
- **Docker & Docker Compose** (for spinning up ChromaDB)
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
| `GEMINI_API_KEY` | Your Google Gemini API key. [Get a key](https://aistudio.google.com/app/apikey) | **Required** |
| `CHROMA_URL` | The endpoint URL of the ChromaDB instance. | `http://localhost:8000` |
| `PORT` | Express server port. | `3001` |
| `GEMINI_FLASH_MODEL` | Gemini model for quick classification. | `gemini-1.5-flash` |
| `GEMINI_PRO_MODEL` | Gemini model for deep threat analysis. | `gemini-1.5-flash` |

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

#### Step 2: Start the Backend Server
In the `backend/` directory, install dependencies and run the server:
```bash
npm install
npm run dev
```
The server will start on `http://localhost:3001` (or your custom `PORT` in `.env`).

#### Step 3: Run the Frontend App
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
- **CascadeFlow Routing**: Utilizing `@cascadeflow/core`, incident analysis is dynamically routed, validating JSON output schemas and falling back gracefully if downstream LLMs fail to parse correctly.
- **Hindsight Memory**: Past threats and their resolutions are indexed inside ChromaDB. Subsequent alerts automatically query historical incidents to build context, optimize threat classification, and prevent security double-jeopardy or repetitive alerts.
