# SENTRI / HIRA Project Overview

## 🎯 Purpose
**SENTRI** (also referred to as **HIRA** - Hindsight‑Informed Recursive Analyst) is a proof-of-concept incident analysis system that compares a naive baseline security response against a memory-informed security analyst pipeline. It uses vector memory (ChromaDB), hindsight pattern correlation, and CascadeFlow model routing to detect composite attack patterns, select advanced mitigations, and produce an auditable delta proof.

The interactive frontend (Tauri desktop app) and backend (Express server) demonstrate the progressive improvement of analysis:
- **Baseline Path**: Quick, simple analysis without contextual memory or multi-path routing.
- **Hindsight Memory Path**: Connects a persistent memory subsystem to correlate incidents across sessions.
- **CascadeFlow Path**: Selects the optimal model route based on incoming complexity and token budgets, outputting a complete audit trail.

---

## 🚀 Execution Phases (100% Completed)
- **Phase 1: Foundation** – Core schema design, mock UI, and Tauri baseline agent.
- **Phase 2: Persistent Memory** – Vector storage integration (ChromaDB) to record and query past incidents.
- **Phase 3: Hindsight Reflection** – Correlation of current logs with past incidents to trigger behavioral overrides.
- **Phase 4: CascadeFlow Routing** – Complexity-based path selection, token budget limits, and audit trails.
- **Phase 5: Evaluation & Edge Cases** – Novel anomaly handling, notification dispatch, and automated validation tests.

---

## 📂 Repository Layout
```
HIRA/
├─ README.md                     # SENTRI high-level overview & setup instructions
├─ package.json                  # Root npm scripts (tauri commands)
├─ package-lock.json             # Root lockfile
├─ vite.config.ts                # Frontend bundler settings
├─ index.html                    # Frontend HTML entrypoint
├─ public/                       # Static public assets
├─ src/                          # React + TypeScript Frontend
│   ├─ App.tsx                   # Main dashboard (Control Panel)
│   ├─ App.css                   # Glassmorphic, dark-theme styling
│   ├─ main.tsx                  # React DOM mounting
│   ├─ types/                    # Shared TypeScript interfaces (schemas, cascade)
│   └─ assets/                   # Images and other static visuals
│
├─ backend/                      # Node.js + Express API Backend
│   ├─ package.json              # Backend dependencies (ChromaDB, Express, Axios)
│   ├─ Dockerfile & docker-compose.yml
│   ├─ scripts/
│   │   └─ runValidation.ts      # Automated test runner comparing Baseline vs. SENTRI
│   ├─ src/
│   │   ├─ index.ts              # Express server entry point & middleware
│   │   ├─ cascade/              # CascadeFlow model routing & audit trail logic
│   │   ├─ fallback/
│   │   │   └─ novelAnomalyHandler.ts # Handles novel anomalies with no history
│   │   ├─ memory/               # ChromaDB connections & embedder services
│   │   ├─ notifications/
│   │   │   └─ notificationStubs.ts   # Dispatches logs to Slack/Email stubs
│   │   ├─ routes/               # API routes (`/api/analyze`, `/api/memory/reset`)
│   │   └─ types/                # Backend types (memory, etc.)
│   └─ tsconfig.json             # Backend typescript configuration
│
└─ src-tauri/                    # Rust Desktop Wrapper Crate
    ├─ Cargo.toml                # Rust crate metadata & dependencies
    ├─ tauri.conf.json           # Native window size, permissions & bundle configuration
    └─ src/
        ├─ main.rs               # Rust binary entrypoint (binds Tauri invoke commands)
        ├─ lib.rs                # Library functions
        └─ schemas.rs            # Shared data shapes mapping back to TS
```

---

## 🛠️ Key Backend Modules

### 1. Model Router (`backend/src/cascade/`)
Applies CascadeFlow to determine if an anomaly goes through a fast path, an escalated model path, or falls back to a degraded mode (e.g. if the input length exceeds token budgets).

### 2. Novel Anomaly Handler (`backend/src/fallback/novelAnomalyHandler.ts`)
Executes when ChromaDB returns no matches for incoming threat signatures. It persists the new incident as a future training pattern and alerts security teams of a novel threat.

### 3. Notification Dispatcher (`backend/src/notifications/notificationStubs.ts`)
Converts incident resolutions into formatted notifications sent via simulated Slack, Email, or Webhook channels depending on the severity rating. Logs are appended to `backend/logs/notifications.jsonl`.

### 4. Validation Script (`backend/scripts/runValidation.ts`)
An offline verification tool. Automatically spins through five standard test sessions and one edge session (to test token budget fallback limits), then outputs a comprehensive performance delta comparison.

---

## ⚙️ How to Run & Validate

### A. Run Local Development
1. **Start Database Services** (if using persistent vector storage):
   ```bash
   cd backend
   docker compose up -d
   ```
2. **Start Backend Server**:
   ```bash
   npm install
   npm run dev      # runs nodemon + ts-node on http://localhost:3001
   ```
3. **Start Frontend Client**:
   ```bash
   # In a separate terminal (from root HIRA/)
   npm install
   npm run dev      # launches Vite Dev Server on http://localhost:5173
   ```
4. **Launch Desktop Window**:
   ```bash
   npm run tauri dev
   ```

### B. Run Automated Performance Validation
To compare baseline response speed/behavior with the optimized SENTRI pipeline:
```bash
cd backend
npm run validate
```
This prints a clean CLI comparison table mapping latency savings and upgraded mitigation outcomes.

---
*Last updated after git pull matching Phase 5 additions.*
