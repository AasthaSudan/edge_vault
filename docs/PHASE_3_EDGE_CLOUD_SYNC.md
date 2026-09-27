# Phase 3: Edge-Cloud Sync & Conflicts (4–7 Oct)

> **Timeline:** 4–7 Oct  
> **Goal:** Two devices converging after working offline; conflicts surface in both inboxes; **server holds zero private points**.  
> **Exit Criterion:** Offline edits on Device A and Device B both reach each other after reconnect; conflicts land in the inbox; `private_on_server == 0` and `routine_on_server == 0`.  
> **Note:** This represents the core technical score for the Qdrant hackathon.

---

## 1. Requirements Covered

| ID | Type | Description | Priority |
|---|---|---|---|
| **FR-12** | Functional | Persisted outbox of shareable writes; survives application restart without data loss. | Must |
| **FR-13** | Functional | Push outbox to Qdrant Server when online (batched, idempotent, retries with backoff). | Must |
| **FR-14** | Functional | Pull fleet knowledge from server via partial snapshots into the local shared shard. | Must |
| **FR-15** | Functional | Detect version conflicts (two devices edited the same memory while offline). | Must |
| **FR-16** | Functional | Detect semantic contradictions (incompatible technical claims about the same asset). | Should |
| **FR-17** | Functional | Conflict resolution inbox: keep local, keep remote, or merge; resolution syncs back to fleet. | Must |
| **NFR-04** | Non-Functional | No data loss on crash (SQLite WAL outbox + Qdrant Edge WAL; recovers inflight batches). | Target |
| **NFR-05** | Non-Functional | Idempotent sync: pushing the same outbox batch twice leaves the server state unchanged. | Target |
| **NFR-06** | Non-Functional | Private data never leaves the device: private shard is never read by sync workers. | Target |
| **NFR-07** | Non-Functional | Eventual convergence: after reconnect, A and B shared shards match within one sync cycle. | Target |

---

## 2. Architecture & The Four Data Paths

```
   ┌────────────────────────────────────────────────────────┐
   │                   EDGE DEVICE (Offline/Online)         │
   │                                                        │
   │  ┌──────────────┐          ┌────────────────────────┐  │
   │  │ Private Shard│ (Never   │      Shared Shard      │  │
   │  │ (data/priv)  │  synced) │      (data/shared)     │  │
   │  └──────────────┘          └───────────▲────────────┘  │
   │                                        │  apply        │
   │                             ┌──────────┴────────────┐  │
   │                             │  Sync Worker          │  │
   │                             │  - Push outbox        │  │
   │  ┌──────────────┐  drains   │  - Pull partial snap  │  │
   │  │ Outbox (DB)  ├──────────►│  - Connectivity check │  │
   │  └──────────────┘           └──────────┬────────────┘  │
   └────────────────────────────────────────┼───────────────┘
                                            │ HTTP /push & /snapshot/partial
                                            ▼
   ┌────────────────────────────────────────────────────────┐
   │                    CLOUD INFRASTRUCTURE                │
   │                                                        │
   │       ┌───────────────────────────────────────┐        │
   │       │   Cloud Sync API (FastAPI :8080)      │        │
   │       │   - Defense-in-depth category guard   │        │
   │       │   - Version & contradiction checks    │        │
   │       │   - Snapshot proxying (Zero API key)  │        │
   │       └──────────────────┬────────────────────┘        │
   │                          │                             │
   │                          ▼                             │
   │       ┌───────────────────────────────────────┐        │
   │       │   Qdrant Server (Docker :6333)        │        │
   │       │   Collection: shared_memory           │        │
   │       └───────────────────────────────────────┘        │
   └────────────────────────────────────────────────────────┘
```

### Golden Sync Rules
1. **Push before Pull, ALWAYS:** The shared shard is server-authoritative. Pulling with a non-empty outbox would overwrite local unsynced edits.
2. **Never Direct to Qdrant:** The edge node *never* communicates directly with Qdrant Server; every mutation passes through the Cloud Sync API where validation, version checking, and contradiction logic reside.
3. **Identical Embedding Alignment:** Both edge and cloud use the exact same embedding model (`bge-small-en-v1.5`), same vector dimensions (384), same distance (Cosine), and compatible BM25 tokenizers.

---

## 3. Directory & File Structure (Phase 3 Additions)

```
edgevault/
├── docker-compose.yml              # Qdrant server container + Cloud Sync API container
├── cloud/
│   ├── Dockerfile
│   ├── scripts/
│   │   └── init_collection.py      # Setup shared_memory collection & indexes
│   └── sync_api/
│       ├── __init__.py
│       ├── main.py                 # FastAPI endpoints (/push, /snapshot/partial, /stats)
│       ├── store.py                # QdrantClient wrapper
│       ├── conflicts.py            # Version & semantic contradiction detector
│       └── models.py               # PushItem, PushResult, Conflict models
└── edge/
    ├── scripts/
    │   └── bootstrap_shared.py     # Pull initial server snapshot to seed local shared shard
    └── edge/
        └── sync/
            ├── __init__.py
            ├── outbox.py           # Enqueue, claim, ack, fail, recover
            ├── connectivity.py     # Health ping & manual simulated offline toggle
            ├── push.py             # Drain outbox to /push
            ├── pull.py             # Snapshot manifest -> partial download -> shard update
            └── worker.py           # Background sync coordinator loop
```

---

## 4. Step-by-Step Implementation Tasks

- [ ] **Task 3.1: Cloud Infrastructure (`docker-compose.yml`)**
  - Run official `qdrant/qdrant:latest` on ports 6333 (HTTP) and 6334 (gRPC).
  - Configure persistent volume `./data/cloud_qdrant`.

- [ ] **Task 3.2: Collection Initializer (`cloud/scripts/init_collection.py`)**
  - Create collection `shared_memory` with dense (384 Cosine) and sparse (`bm25` with `Modifier.Idf`).
  - Create payload indexes for `category`, `asset_tag`, `device_id`, `sync_state`, `updated_at`, `deleted`.
  - Fix `shard_number=1` so edge shards pull shard index 0.

- [ ] **Task 3.3: Edge Outbox Manager (`edge/sync/outbox.py`)**
  - Transactional batch operations: `claim(n=20)` marks rows as `inflight`.
  - `ack(ids)` marks `done`.
  - `fail(ids, err)` increments `attempts`, sets `last_error`, restores to `pending`.
  - `recover()` on startup resets any dangling `inflight` items back to `pending`.

- [ ] **Task 3.4: Connectivity Monitor (`edge/sync/connectivity.py`)**
  - Pings `GET /health` with a 1.5s timeout.
  - Supports simulated offline override via `offline_forced` setting in SQLite.

- [ ] **Task 3.5: Edge Push Logic (`edge/sync/push.py`)**
  - Claims batches of 20 and sends them to `POST /push`.
  - Correctly serializes BM25 sparse vectors as indices and values.
  - Ingests returned conflict payloads into local `conflicts` table.

- [ ] **Task 3.6: Edge Pull Logic (`edge/sync/pull.py`)**
  - Guards with `if outbox.depth() > 0: skip`.
  - Obtains local shard manifest: `shared.shard.snapshot_manifest()`.
  - Requests partial delta snapshot from `POST /snapshot/partial`.
  - Applies delta directly: `shared.shard.update_from_snapshot(path)`.

- [ ] **Task 3.7: Background Sync Worker (`edge/sync/worker.py`)**
  - Runs in FastAPI lifespan: loops every 5 seconds when online.
  - Executes push until outbox is drained; triggers pull after push or if idle for 30 seconds.
  - Implements exponential backoff on network failure (up to 30s).

- [ ] **Task 3.8: Cloud Sync API (`cloud/sync_api/`)**
  - **Category Defense-in-depth:** Rejects any push item where `category != "shareable"`.
  - **Version Conflict Checking:** Compares `item.base_version` with existing point version.
  - **Semantic Contradiction Checking:** If dense cosine similarity is between 0.80 and 0.92 for the same `asset_tag`, asks an LLM if the notes make contradictory claims.
  - **Snapshot Proxies:** Securely streams Qdrant snapshots without exposing Qdrant credentials to edge devices.
  - **Proof of Privacy (`GET /stats`):** Exposes counts of `total`, `private_on_server` (must be 0), and `routine_on_server` (must be 0).

- [ ] **Task 3.9: Initial Shard Bootstrapping (`edge/scripts/bootstrap_shared.py`)**
  - Downloads initial collection snapshot and unpacks it into `edge/data/<device_id>/shared`.

---

## 5. Code Specifications

### 5.1 Cloud Collection Initialization (`cloud/scripts/init_collection.py`)
```python
import os
from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
KEY = os.getenv("QDRANT_API_KEY", None)
COLL = "shared_memory"

client = QdrantClient(url=QDRANT_URL, api_key=KEY)

if not client.collection_exists(COLL):
    client.create_collection(
        collection_name=COLL,
        vectors_config={"dense": models.VectorParams(size=384, distance=models.Distance.COSINE)},
        sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        shard_number=1,  # Edge devices pull shard 0
    )

for field, schema in [
    ("category", models.PayloadSchemaType.KEYWORD),
    ("asset_tag", models.PayloadSchemaType.KEYWORD),
    ("device_id", models.PayloadSchemaType.KEYWORD),
    ("sync_state", models.PayloadSchemaType.KEYWORD),
    ("updated_at", models.PayloadSchemaType.INTEGER),
    ("deleted", models.PayloadSchemaType.BOOL),
]:
    client.create_payload_index(COLL, field_name=field, field_schema=schema)

print(f"Collection '{COLL}' initialized with dual vectors and payload indexes.")
```

### 5.2 Edge Outbox (`edge/edge/sync/outbox.py`)
```python
import json, time
from edge import db

def enqueue(memory_id: str, op: str, point: dict, version: int, base_version: int):
    db.execute(
        "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (memory_id, op, json.dumps(point), version, base_version, int(time.time() * 1000))
    )

def claim(n: int = 20) -> list[dict]:
    rows = db.execute("SELECT * FROM outbox WHERE status='pending' ORDER BY id LIMIT ?", (n,)).fetchall()
    ids = [r["id"] for r in rows]
    if ids:
        db.execute(f"UPDATE outbox SET status='inflight' WHERE id IN ({','.join('?' * len(ids))})", ids)
    return [dict(r) for r in rows]

def ack(ids: list[int]):
    db.execute(f"UPDATE outbox SET status='done' WHERE id IN ({','.join('?' * len(ids))})", ids)

def fail(ids: list[int], err: str):
    db.execute(
        f"UPDATE outbox SET status='pending', attempts=attempts+1, last_error=? WHERE id IN ({','.join('?' * len(ids))})",
        [err, *ids]
    )

def depth() -> int:
    return db.execute("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'inflight')").fetchone()[0]

def recover():
    """Startup recovery: reset any unacknowledged inflight items back to pending."""
    db.execute("UPDATE outbox SET status='pending' WHERE status='inflight'")
```

### 5.3 Edge Push Implementation (`edge/edge/sync/push.py`)
```python
import json
from edge.config import settings
from edge.sync import outbox
from edge.events import emit
from edge import db

async def push_once(client) -> int:
    rows = outbox.claim(20)
    if not rows:
        return 0
    ids = [r["id"] for r in rows]
    body = {
        "device_id": settings.device_id,
        "items": [
            {
                "memory_id": r["memory_id"],
                "op": r["op"],
                "point": json.loads(r["point_json"]),
                "version": r["version"],
                "base_version": r["base_version"]
            }
            for r in rows
        ]
    }
    try:
        resp = await client.post(f"{settings.sync_api_url}/push", json=body, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        outbox.fail(ids, str(e))
        emit("sync.push.failed", data={"error": str(e)})
        raise

    result = resp.json()  # {"accepted": [...], "conflicts": [...]}
    outbox.ack(ids)

    # Ingest any conflicts reported by server
    for c in result.get("conflicts", []):
        db.execute(
            "INSERT OR IGNORE INTO conflicts(id, memory_id, kind, local_json, remote_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (c["id"], c["memory_id"], c["kind"], json.dumps(c["local"]), json.dumps(c["remote"]), c["created_at"])
        )
        emit("conflict.opened", c["memory_id"], {"kind": c["kind"]})

    emit("sync.push.ok", data={"accepted": len(result["accepted"]), "conflicts": len(result.get("conflicts", []))})
    return len(rows)
```

### 5.4 Edge Pull Implementation (`edge/edge/sync/pull.py`)
```python
import tempfile
from pathlib import Path
from edge.config import settings
from edge.store.shards import shared
from edge.sync import outbox
from edge.events import emit

async def pull_once(client) -> bool:
    # Golden Rule: Never pull if local edits are pending
    if outbox.depth() > 0:
        emit("sync.pull.skipped", data={"reason": "outbox not empty"})
        return False

    with shared.lock:
        manifest = shared.shard.snapshot_manifest()

    with tempfile.TemporaryDirectory(dir=settings.dir) as tmp:
        path = Path(tmp) / "partial.snapshot"
        async with client.stream(
            "POST",
            f"{settings.sync_api_url}/snapshot/partial",
            json=manifest,
            timeout=60
        ) as r:
            r.raise_for_status()
            with open(path, "wb") as f:
                async for chunk in r.aiter_bytes():
                    f.write(chunk)

        with shared.lock:
            shared.shard.update_from_snapshot(str(path))

    emit("sync.pull.ok")
    return True
```

### 5.5 Background Sync Worker (`edge/edge/sync/worker.py`)
```python
import asyncio, time, httpx
from edge.sync import connectivity, push, pull, outbox
from edge.events import emit

async def run():
    outbox.recover()
    delay, was_online, last_pull = 5, None, 0.0

    async with httpx.AsyncClient() as client:
        while True:
            is_online = await connectivity.online(client)
            if is_online != was_online:
                emit("sync.online" if is_online else "sync.offline")
                was_online = is_online

            if is_online:
                try:
                    pushed = 0
                    while (n := await push.push_once(client)):
                        pushed += n

                    if pushed or (time.time() - last_pull > 30):
                        if await pull.pull_once(client):
                            last_pull = time.time()
                    delay = 5
                except Exception:
                    delay = min(delay * 2, 30)

            await asyncio.sleep(delay)
```

### 5.6 Cloud Sync API (`cloud/sync_api/main.py`)
```python
import os, httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from qdrant_client import QdrantClient, models
from sync_api import conflicts

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
KEY = os.getenv("QDRANT_API_KEY", None)
COLL = "shared_memory"

q = QdrantClient(url=QDRANT_URL, api_key=KEY)
app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True}

def to_point(p: dict) -> models.PointStruct:
    v = p["vector"]
    return models.PointStruct(
        id=p["id"],
        payload=p["payload"],
        vector={
            "dense": v["dense"],
            "bm25": models.SparseVector(indices=v["bm25"]["indices"], values=v["bm25"]["values"])
        }
    )

@app.post("/push")
def push(body: dict):
    accepted, found = [], []
    for item in body["items"]:
        pl = item["point"]["payload"]

        # Defense-in-depth: Never accept non-shareable items
        if pl.get("category") != "shareable":
            raise HTTPException(400, "Security violation: only shareable memories may be pushed")

        existing = q.retrieve(COLL, ids=[item["memory_id"]], with_payload=True, with_vectors=False)
        cur = existing[0].payload if existing else None

        # Idempotent repeat: already up to date from same device
        if cur and cur["version"] == item["version"] and cur["device_id"] == pl["device_id"]:
            accepted.append(item["memory_id"])
            continue

        # Version conflict detected
        if cur and cur["version"] > item["base_version"]:
            found.append(conflicts.record("version", item, cur))
            continue

        pl["sync_state"] = "synced"
        if item["op"] == "delete":
            pl["deleted"] = True

        q.upsert(COLL, points=[to_point(item["point"])])
        accepted.append(item["memory_id"])

        # Semantic Contradiction Check (Should-have)
        if item["base_version"] == 0:
            c = conflicts.check_contradiction(q, COLL, item)
            if c:
                found.append(c)

    return {"accepted": accepted, "conflicts": found}

async def _proxy(method: str, path: str, json_data=None):
    client = httpx.AsyncClient(timeout=120)
    req = client.build_request(
        method,
        f"{QDRANT_URL}/collections/{COLL}/shards/0/{path}",
        headers={"api-key": KEY} if KEY else {},
        json=json_data
    )
    r = await client.send(req, stream=True)
    return StreamingResponse(r.aiter_bytes(), media_type="application/octet-stream")

@app.get("/snapshot")
async def snapshot():
    return await _proxy("GET", "snapshot")

@app.post("/snapshot/partial")
async def partial(req: Request):
    return await _proxy("POST", "snapshot/partial/create", await req.json())

@app.get("/stats")
def stats():
    count = lambda f: q.count(COLL, count_filter=f, exact=True).count
    must = lambda k, v: models.Filter(must=[models.FieldCondition(key=k, match=models.MatchValue(value=v))])
    return {
        "total": count(None),
        "private_on_server": count(must("category", "private")),
        "routine_on_server": count(must("category", "routine"))
    }
```

---

## 6. Conflict Resolution Rules

| Conflict Case | Detection Method | Server Action |
|---|---|---|
| **Version Conflict** | Server point exists and `server_version > item.base_version` (edited by another device). | Retain server copy; create conflict record; return conflict to edge inbox. |
| **Semantic Contradiction** | Dense cosine similarity 0.80–0.92 on same `asset_tag` from different device; LLM verifies contradictory claims. | Accept both points; log contradiction conflict linking both records. |
| **Delete vs Edit** | Tombstone arrives but `server_version > base_version`. | Surface as version conflict; let user choose winner. |
| **Idempotent Retry** | Same `memory_id` + `version` + `device_id`. | Treat as no-op; return accepted. |

---

## 7. Exit Criteria & Verification Tests

```bash
# 1. Start Cloud Infrastructure and Device Nodes
docker compose up -d
python cloud/scripts/init_collection.py

# 2. Bootstrap shared shards on Device A and Device B
DEVICE_ID=device-a python edge/scripts/bootstrap_shared.py
DEVICE_ID=device-b python edge/scripts/bootstrap_shared.py

# 3. Force both devices offline
curl -X POST http://localhost:7001/sync/offline -d "on=true"
curl -X POST http://localhost:7002/sync/offline -d "on=true"

# 4. Create notes on Device A while offline:
# - 1 shareable fix ("P-200 cavitation resolved by replacing impeller")
# - 1 private note ("Access pin is 9912")
# - 1 routine note ("Reached site 10:00")

# 5. Create concurrent offline edit on Device B for a shared note

# 6. Bring Device A online, then Device B online:
curl -X POST http://localhost:7001/sync/offline -d "on=false"
curl -X POST http://localhost:7002/sync/offline -d "on=false"

# 7. Verification:
# - Within 15 seconds, Device A's fix is searchable on Device B.
# - Device B's concurrent edit creates a conflict row in both inboxes.
# - Cloud audit check:
curl http://localhost:8080/stats
# MUST return: {"total": N, "private_on_server": 0, "routine_on_server": 0}
```

---

## 8. Readiness for Phase 4 Checklist

- [ ] Pushing the same outbox batch multiple times produces zero duplicate records.
- [ ] Pull operations are strictly bypassed until the outbox is fully drained.
- [ ] Server `GET /stats` returns strictly `0` for `private_on_server` and `routine_on_server`.
- [ ] Concurrent edits generate conflict records that appear in the SQLite `conflicts` table.
