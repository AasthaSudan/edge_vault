# EdgeVault — Startup & Verification Guide

This guide contains the exact commands to start all EdgeVault services across separate terminals and verify each subsystem (AI Memory Gate, Proof of Privacy, Hybrid Search, and Offline Outbox Sync).

---

## Prerequisites (Terminal 0 / Background)

Ensure the cloud Qdrant vector engine is running via Docker:

```powershell
docker compose up -d
```
Verify Qdrant is healthy by visiting [http://localhost:6333/dashboard](http://localhost:6333/dashboard) or checking `docker ps`.

---

## 1. Startup Commands (3 Terminals)

### Terminal 1: Cloud Sync API (`:8080`)
Coordinates fleet sync, resolves multi-device conflicts, and provides the Proof of Privacy audit endpoint.

```powershell
cd C:\Users\User\OneDrive\Desktop\edge_vault
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH="cloud"
uvicorn sync_api.main:app --host 0.0.0.0 --port 8080 --reload
```
*Health check:* [http://localhost:8080/health](http://localhost:8080/health)

---

### Terminal 2: Edge Node A (`:7001`)
The local on-device node running embedded dual shards (Private & Shared) on `qdrant-edge-py`, on-device embeddings (`bge-small-en-v1.5`), and the Memory Gate.

```powershell
cd C:\Users\User\OneDrive\Desktop\edge_vault
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH="edge"
$env:DEVICE_ID="device-a"
$env:PORT="7001"
uvicorn edge.main:app --host 0.0.0.0 --port 7001 --reload
```
*Health check:* [http://localhost:7001/health](http://localhost:7001/health)

---

### Terminal 3: Dashboard Web UI (`:3000`)
The interactive Next.js dashboard for real-time visualization of memory distribution, local search playground, and outbox sync status.

```powershell
cd C:\Users\User\OneDrive\Desktop\edge_vault\dashboard
npm run dev
```
*Access UI:* [http://localhost:3000](http://localhost:3000)

---

## 2. Verification & Test Commands (Terminal 4)

Open a **4th PowerShell terminal** to test the complete edge lifecycle:

### Test 1: Ingest Operational Fix &rarr; Verdict: `shareable`
Technician inputs a reusable repair SOP. The AI Gate classifies it as `shareable`, stores it in the local `shared` shard, enqueues it in the SQLite outbox, and syncs it to the cloud fleet.

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "Turbine 4 bearing temperature spiked to 92C. Flushed reservoir with ISO VG 46 synthetic lubricant and replaced secondary intake filter.", "title": "Turbine 4 Bearing Overheat Fix", "asset_tag": "TURBINE-04"}'
```
*Expected Outcome:* `category: "shareable"`, `sync_state: "pending"` &rarr; `synced`. Dashboard **SHAREABLE** counter increments by 1.

---

### Test 2: Ingest Sensitive PII / Credentials &rarr; Verdict: `private`
Technician inputs sensitive credentials or access codes. The deterministic pre-filter catches the sensitive data and routes it to the local-only `private` shard.

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "Control room access code for Substation B is PIN 8492. Emergency root password is SuperSecret2026! Keep safe.", "title": "Substation B Access Code"}'
```
*Expected Outcome:* `category: "private"`, `sync_state: "local_only"`. Dashboard **PRIVATE (LOCAL ONLY)** increments by 1. **`PRIVATE ON SERVER` remains strictly 0**.

---

### Test 3: Ingest Routine Operational Status &rarr; Verdict: `routine`
Technician inputs shift status or routine inspection noise. The Memory Gate assigns a 14-day auto-purge TTL to prevent disk bloat.

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "Daily inspection completed on Pump 2. All gauges normal, no vibrations observed. Routine shift handoff.", "title": "Pump 2 Shift Handoff", "asset_tag": "PUMP-02"}'
```
*Expected Outcome:* `category: "routine"`, `expires_at: <14 days in ms>`. Dashboard **ROUTINE (TTL 14D)** increments by 1.

---

### Test 4: Offline Sub-10ms Hybrid Search (RRF)
Executes combined dense embeddings (`bge-small-en-v1.5`) and BM25 sparse keyword search directly on-device using Reciprocal Rank Fusion with zero cloud roundtrips:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/search" -ContentType "application/json" -Body '{"q": "bearing overheat lubricant filter", "mode": "hybrid", "limit": 5}'
```
*Expected Outcome:* Returns ranked matching memories with sub-10ms execution latency (`latency_ms.total < 10`).

---

### Test 5: Offline Field Mode & Outbox Sync Simulation
Simulates field work in zero-connectivity environments (e.g. underground or offshore) and verifies graceful synchronization upon reconnection:

```powershell
# 1. Simulate losing network connection
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/sync/offline?on=true"
# (Observe: Dashboard badge changes from 'Online' to amber 'Offline')

# 2. Add an emergency maintenance note while offline
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "Offline emergency patch: tightened valve C-10 to 45 PSI.", "title": "Offline Patch", "asset_tag": "VALVE-C10"}'
# (Observe: Note is saved in SQLite WAL outbox; 'Outbox: 1' badge appears in UI)

# 3. Restore network connection
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/sync/offline?on=false"
# (Observe: Dashboard switches to 'Online', outbox drains to 0, and note syncs to cloud)
```

---

## Summary of Ports & Endpoints

| Service | Port | Key Endpoints | Purpose |
| :--- | :--- | :--- | :--- |
| **Qdrant Server** | `6333` | `/dashboard`, `/collections` | Docker vector store |
| **Cloud Sync API** | `8080` | `/health`, `/push`, `/pull/records`, `/stats` | Fleet synchronization & privacy audit |
| **Edge Node A** | `7001` | `/health`, `/memories`, `/search`, `/sync/status` | On-device private AI memory node |
| **Dashboard UI** | `3000` | `/`, `/memories`, `/search`, `/sync`, `/conflicts` | Next.js visual control plane |
