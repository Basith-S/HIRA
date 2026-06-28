# SENTRI

## Overview

SENTRI is a proof-of-concept incident analysis system that compares a naive baseline response against a memory-informed security analyst pipeline. It uses Hindsight memory and CascadeFlow routing to surface composite attack patterns, choose mitigations, and produce an auditable delta proof.

## Architecture

- Tauri frontend
- Express backend
- ChromaDB vector memory
- Hindsight pattern correlation
- CascadeFlow model routing and audit trail

## Setup

```bash
cd backend
docker compose up -d
npm install
npm run dev
```

In another terminal, run the frontend:

```bash
npm install
npm run dev
```

## Running The Demo

```bash
npm run demo
```

The interactive frontend can also run the Session 1, 3, and 5 incident flow against the backend after memory is enabled.

## Running Validation

```bash
cd backend
npm run validate
```

The validation runner compares `/api/analyze?mode=baseline` against the full SENTRI pipeline and prints the Phase 5 Before vs. After report.

## Phase Completion Status

- Phase 1: Foundation, schemas, mock UI, baseline agent - complete
- Phase 2: Persistent memory and vector storage - complete
- Phase 3: Hindsight reflection and behavioral override - complete
- Phase 4: CascadeFlow routing and audit trail - complete
- Phase 5: Evaluation, polish, and edge cases - complete
