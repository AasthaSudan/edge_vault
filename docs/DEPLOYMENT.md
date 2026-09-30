# EdgeVault Deployment Guide

EdgeVault has two deployment targets:

| Component | Where it runs | How |
|---|---|---|
| **Cloud Sync API + Qdrant** | One server (VM or container host) | `docker-compose.prod.yml` behind an HTTPS reverse proxy |
| **Edge node + local LLM + dashboard** | Every technician laptop / field device | Native install (Windows script below) |

The edge node is intentionally **not** containerized: it must talk to Ollama on loopback (the LLM client refuses any non-loopback host), and it serves the private shard, so it binds to `127.0.0.1` only.

---

## 1. Cloud (one server)

### 1.1 Secrets

```bash
cp cloud/.env.production.example cloud/.env.production
python -c "import secrets; print(secrets.token_urlsafe(48))"   # run twice: FLEET_API_KEY, QDRANT_API_KEY
```

Fill in `cloud/.env.production` (it is git-ignored):

| Variable | Meaning |
|---|---|
| `FLEET_API_KEY` | Shared secret every edge sends as `Authorization: Bearer …` (≥ 32 chars) |
| `QDRANT_API_KEY` | Qdrant's own key; only the sync API uses it, Qdrant is not published |
| `CORS_ORIGINS` | Dashboard origins allowed to read the public `/stats` (no `*`) |
| `CORROBORATION_MIN_SCORE` | Similarity at which another device's report counts as corroboration (default 0.88) |
| `SYNC_API_BIND` | Host interface for port 8080 (keep `127.0.0.1` behind a reverse proxy) |

### 1.2 Start

```bash
docker compose -f docker-compose.prod.yml --env-file cloud/.env.production up -d --build
docker compose -f docker-compose.prod.yml ps        # sync-api should be "healthy"
```

The API creates the collection and payload indexes on startup (idempotent), so there is no manual init step.

`EDGEVAULT_ENV=production` (set by the compose file) makes the API **refuse to start** without a strong `FLEET_API_KEY` and an explicit `CORS_ORIGINS`, and hides `/docs`.

### 1.3 HTTPS

Terminate TLS in front of port 8080 (Caddy, nginx, or a cloud load balancer). Minimal Caddyfile:

```
sync.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### 1.4 What is public vs protected

| Endpoint | Auth | Why |
|---|---|---|
| `GET /health` | public | Liveness + Qdrant reachability; edges use it to detect connectivity |
| `GET /stats` | public | Counts only; the privacy proof (`private_on_server = 0`) |
| `POST /push`, `GET /pull/records`, `GET /snapshot`, `POST /snapshot/partial`, `POST /conflicts/resolve` | `Bearer FLEET_API_KEY` | Fleet data |

### 1.5 Backups

Back up the two named volumes: `qdrant_data` (fleet notes) and `sync_data` (conflict records). Private notes never reach the cloud, so the cloud holds only shareable fleet knowledge.

### 1.6 Scaling note

Run **one** API replica: conflict records live in SQLite and `server_ts` (the pull cursor clock) is issued in-process. This comfortably serves a fleet of hundreds of devices; multi-replica would need both moved into Qdrant/Postgres.

---

## 2. Edge device (each technician laptop, Windows)

### 2.1 One-time setup (needs internet)

```powershell
git clone https://github.com/AasthaSudan/edge_vault.git
cd edge_vault
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python edge\scripts\provision_models.py      # embedding model, cached for offline use

ollama pull qwen2.5:1.5b                                        # the benchmarked model (docs/PHASE_5_LOCAL_INTELLIGENCE.md)
setx OLLAMA_HOST "127.0.0.1:11434"
setx OLLAMA_MAX_LOADED_MODELS 1
setx OLLAMA_KEEP_ALIVE "30m"
# restart the Ollama app after setx

cd dashboard; npm ci; npm run build; cd ..
```

### 2.2 Configure `.env` (repo root)

```bash
DEVICE_ID=field-laptop-017        # unique per device
AUTHOR=Priya S
SYNC_API_URL=https://sync.example.com
FLEET_API_KEY=<same value as the cloud>
OLLAMA_MODEL=qwen2.5:1.5b
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### 2.3 Run

```powershell
powershell -ExecutionPolicy Bypass -File deploy\edge\start-edge.ps1   # pre-flight checks, then 127.0.0.1:7001
cd dashboard; npm run start                                           # http://localhost:3000
```

`start-edge.ps1` checks that Ollama answers on loopback with the configured model, that the embedding model is provisioned, and that a fleet key is set when the cloud URL is HTTPS. It serves the edge API on `127.0.0.1` only.

The dashboard's `NEXT_PUBLIC_EDGE_API` / `NEXT_PUBLIC_CLOUD_API` are baked in at `npm run build`; set them (for example in `dashboard/.env.local`) before building if the defaults (`http://127.0.0.1:7001`, `http://127.0.0.1:8080`) don't apply.

To start at login, add both commands to Windows Task Scheduler ("At log on", "Run whether user is logged on or not").

### 2.4 Security model on the device

- The edge API binds to `127.0.0.1` and only accepts browser requests from `CORS_ORIGINS` (the local dashboard). Never widen this: the edge serves **private** notes.
- The LLM client refuses a non-loopback Ollama host or a cloud-hosted model tag at startup.
- Only `privacy/egress.py` can write to the outbox, and it re-checks category + PII on every item (enforced by `lint-imports` and tests).
- Every note write is flushed to disk before the API returns (crash-safe).

---

## 3. Release checklist

Run on the demo/target hardware with Ollama running:

```bash
PYTHONPATH=edge pytest edge/tests -q --ignore=edge/tests/test_sync.py --ignore=edge/tests/test_search.py
PYTHONPATH=edge lint-imports
PYTHONPATH=edge python edge/tests/test_sync.py           # needs the cloud API running
PYTHONPATH=edge python edge/tests/eval_gate.py           # gate: >= 90%, 0 false shareables, 0 flips
PYTHONPATH=edge python edge/tests/eval_assistant.py      # citations, refusals, no invented numbers
PYTHONPATH=edge python edge/tests/eval_reconcile.py      # conflict reconciliation
cd dashboard && npm run build
```

CI (`.github/workflows/ci.yml`) runs everything except the three LLM evals on every push and pull request.
