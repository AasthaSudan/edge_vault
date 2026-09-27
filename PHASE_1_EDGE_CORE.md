# Phase 1: Edge Core (28–30 Sep)

> **Timeline:** 28–30 Sep  
> **Goal:** One device stores and searches memories fully offline.  
> **Exit Criterion:** Hybrid search returns correct results with Wi-Fi off, in **under 50 ms**.  
> **Focus:** No gate and no sync yet; categories are assigned manually.

---

## 1. Requirements Covered

| ID | Type | Description | Priority |
|---|---|---|---|
| **FR-01** | Functional | Create a memory from text (`title` optional, `body` required, `asset_tag` optional). | Must |
| **FR-02** | Functional | Store every memory with a dense vector (BAAI/bge-small-en-v1.5) and a BM25 sparse vector. | Must |
| **FR-03** | Functional | Hybrid search (dense + BM25, Reciprocal Rank Fusion / RRF) across private and shared shards. | Must |
| **FR-04** | Functional | Filter search by category, asset tag, device, date range. | Must |
| **FR-05** | Functional | Update and delete a memory (`delete = tombstone`, not hard delete, for shareable items). | Must |
| **FR-06** | Functional | All of FR-01 to FR-05 work with **zero network connectivity**. | Must |
| **NFR-01** | Non-Functional | Edge search latency p95 < 50 ms on laptop CPU (including query embedding). | Target |
| **NFR-03** | Non-Functional | Zero network calls required for write, search, and storage. | Target |
| **NFR-04** | Non-Functional | No data loss on crash (Edge WAL-backed storage; passes `kill -9` test). | Target |

---

## 2. Directory & File Structure (Phase 1 Target)

```
edgevault/
├── Makefile                        # Root shortcuts
├── .env.example                    # Environment template
└── edge/
    ├── pyproject.toml              # Python 3.11 + uv workspace dependencies
    ├── data/                       # Local storage (git-ignored)
    │   └── models/                 # Cached offline embeddings
    │   └── <device_id>/
    │       ├── private/            # Qdrant Edge private shard
    │       └── shared/             # Qdrant Edge shared shard
    ├── edge/
    │   ├── __init__.py
    │   ├── config.py               # Pydantic BaseSettings
    │   ├── events.py               # Stub/base event emitter
    │   ├── main.py                 # FastAPI application & lifespan
    │   ├── store/
    │   │   ├── __init__.py
    │   │   ├── embed.py            # FastEmbed dense + Qdrant Edge BM25
    │   │   ├── shards.py           # Thread-safe Shard wrapper & indexes
    │   │   └── search.py           # Hybrid RRF search across shards
    │   ├── memory/
    │   │   ├── __init__.py
    │   │   ├── models.py           # Pydantic models & payload schema
    │   │   └── service.py          # CRUD orchestration
    │   └── api/
    │       ├── __init__.py
    │       ├── memories.py         # Memory CRUD endpoints
    │       └── search.py           # Search endpoint with latency breakdown
    ├── scripts/
    │   └── provision_models.py     # Offline model pre-fetcher
    └── tests/
        └── test_search.py          # Benchmark & search accuracy test
```

---

## 3. Step-by-Step Implementation Tasks

- [ ] **Task 1.1: Project Setup & Dependency Pinning**
  - Initialize project with `uv` (Python 3.11).
  - Pin versions: `qdrant-edge-py`, `fastembed`, `fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, `httpx`.
  - Create `.env.example` and base `Makefile`.

- [ ] **Task 1.2: Model Provisioning Script (`provision_models.py`)**
  - Download `BAAI/bge-small-en-v1.5` dense model into `edge/data/models/` while online.
  - Set `local_files_only=True` so it runs strictly offline thereafter.

- [ ] **Task 1.3: Settings Configuration (`edge/config.py`)**
  - Configure device identity (`DEVICE_ID`), data directory, dense dimensions (384), model paths.

- [ ] **Task 1.4: Dual Sharding Store (`edge/store/shards.py`)**
  - Implement thin `Shard` class with `threading.Lock()` (Qdrant Edge calls are synchronous; FastAPI runs routes in a thread pool).
  - Initialize two local shards: `private` and `shared`.
  - Create payload indexes on startup (`category`, `asset_tag`, `device_id`, `sync_state`, `updated_at`, `deleted`).

- [ ] **Task 1.5: Offline Embedding Engine (`edge/store/embed.py`)**
  - Configure FastEmbed for 384-dim dense cosine vectors.
  - Configure Qdrant Edge built-in BM25 (`embed_document` for docs, `embed_query` for queries).

- [ ] **Task 1.6: Hybrid Search with RRF (`edge/store/search.py`)**
  - Query both `private` and `shared` shards with both dense and BM25 vectors (4 query lists total).
  - Implement Reciprocal Rank Fusion (`_rrf`, default $k=60$) in Python.
  - Filter out tombstones (`deleted == True`) and apply optional payload filters.
  - Measure and report embedding latency vs search latency.

- [ ] **Task 1.7: Memory Service & Models (`edge/memory/service.py`)**
  - Implement `create`, `get`, `list`, `update`, `delete`.
  - Deletion logic: Soft-delete tombstone (`deleted = True`) for shareable notes; hard-delete for private notes.
  - ID standard: UUIDv4 generated on the device.

- [ ] **Task 1.8: Edge REST API (`edge/api/`)**
  - Endpoints: `GET /health`, `POST /memories`, `GET /memories`, `GET /memories/{id}`, `PATCH /memories/{id}`, `DELETE /memories/{id}`, `POST /search`.

---

## 4. Code Specifications

### 4.1 Dependency Spec (`edge/pyproject.toml`)
```toml
[project]
name = "edgevault-edge"
version = "0.1.0"
description = "EdgeVault on-device node"
requires-python = ">=3.11,<3.12"
dependencies = [
    "qdrant-edge-py>=0.1.0",
    "fastembed>=0.3.0",
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.28.0",
    "pydantic>=2.6.0",
    "pydantic-settings>=2.2.0",
    "httpx>=0.27.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 4.2 Configuration (`edge/edge/config.py`)
```python
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    device_id: str = "device-a"
    author: str = "Tech A"
    data_root: Path = Path("./data")
    dense_model: str = "BAAI/bge-small-en-v1.5"
    dense_dim: int = 384
    sync_api_url: str = "http://localhost:8080"
    ollama_model: str = "gemma3:1b"
    dedup_threshold: float = 0.92
    routine_ttl_days: int = 14

    @property
    def dir(self) -> Path:
        return self.data_root / self.device_id

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
```

### 4.3 Model Provisioning (`edge/scripts/provision_models.py`)
```python
"""Run once while connected to the internet to pre-cache the embedding model."""
from pathlib import Path
from fastembed import TextEmbedding
from edge.config import settings

def main():
    models_dir = settings.data_root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {settings.dense_model} to {models_dir}...")
    TextEmbedding(model_name=settings.dense_model, cache_dir=str(models_dir))
    print("FastEmbed model provisioned successfully.")

if __name__ == "__main__":
    main()
```

### 4.4 Embeddings Module (`edge/edge/store/embed.py`)
```python
from fastembed import TextEmbedding
from qdrant_edge import Bm25, Bm25Config
from edge.config import settings

MODELS_DIR = str(settings.data_root / "models")
_dense = TextEmbedding(
    model_name=settings.dense_model,
    cache_dir=MODELS_DIR,
    local_files_only=True
)
_bm25 = Bm25(Bm25Config(language="english"))

def embed_doc(text: str) -> dict:
    dense = next(iter(_dense.embed([text]))).tolist()
    return {"dense": dense, "bm25": _bm25.embed_document(text)}

def embed_query(text: str) -> dict:
    dense = next(iter(_dense.embed([text]))).tolist()
    return {"dense": dense, "bm25": _bm25.embed_query(text)}
```
> [!IMPORTANT]
> Always call `embed_document` for storing notes and `embed_query` for incoming search queries. Mixing them produces corrupted BM25 scores.

### 4.5 Shards Manager (`edge/edge/store/shards.py`)
```python
import threading
from pathlib import Path
from qdrant_edge import (
    EdgeShard, EdgeConfig, EdgeVectorParams,
    EdgeSparseVectorParams, Distance, Modifier,
    UpdateOperation, PayloadSchemaType
)
from edge.config import settings

CONFIG = EdgeConfig(
    vectors={"dense": EdgeVectorParams(size=settings.dense_dim, distance=Distance.Cosine)},
    sparse_vectors={"bm25": EdgeSparseVectorParams(modifier=Modifier.Idf)},
)

INDEXES = {
    "category": PayloadSchemaType.Keyword,
    "asset_tag": PayloadSchemaType.Keyword,
    "device_id": PayloadSchemaType.Keyword,
    "sync_state": PayloadSchemaType.Keyword,
    "updated_at": PayloadSchemaType.Integer,
    "deleted": PayloadSchemaType.Bool,
}

class Shard:
    """Thin wrapper: one lock per shard, because Edge operations are synchronous."""
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.shard = self._open()

    def _open(self) -> EdgeShard:
        if self.path.exists() and any(self.path.iterdir()):
            return EdgeShard.load(str(self.path))
        self.path.mkdir(parents=True, exist_ok=True)
        s = EdgeShard.create(str(self.path), CONFIG)
        for field, schema in INDEXES.items():
            s.update(UpdateOperation.create_field_index(field, schema))
        return s

    def reopen(self):
        with self.lock:
            self.shard.close()
            self.shard = EdgeShard.load(str(self.path))

private = Shard(settings.dir / "private")
shared = Shard(settings.dir / "shared")

def shard_for(category: str) -> Shard:
    return shared if category == "shareable" else private
```

### 4.6 Search Implementation (`edge/edge/store/search.py`)
```python
import time
from qdrant_edge import Query, QueryRequest, Filter, FieldCondition, MatchValue
from edge.store.embed import embed_query
from edge.store.shards import private, shared

NOT_DELETED = FieldCondition(key="deleted", match=MatchValue(value=True))

def _filter(category=None, asset_tag=None, device_id=None) -> Filter:
    must = []
    if category:
        must.append(FieldCondition(key="category", match=MatchValue(value=category)))
    if asset_tag:
        must.append(FieldCondition(key="asset_tag", match=MatchValue(value=asset_tag)))
    if device_id:
        must.append(FieldCondition(key="device_id", match=MatchValue(value=device_id)))
    return Filter(must=must or None, must_not=[NOT_DELETED])

def _rrf(lists, k: int = 60):
    scores, best = {}, {}
    for results in lists:
        for rank, p in enumerate(results):
            scores[p.id] = scores.get(p.id, 0.0) + 1.0 / (k + rank + 1)
            best.setdefault(p.id, p)
    order = sorted(scores, key=scores.get, reverse=True)
    return [(best[i], scores[i]) for i in order]

def search(q: str, mode: str = "hybrid", limit: int = 10, **filters):
    t0 = time.perf_counter()
    vec = embed_query(q)
    t_embed = time.perf_counter()

    names = {"hybrid": ["dense", "bm25"], "dense": ["dense"], "bm25": ["bm25"]}[mode]
    flt = _filter(**filters)
    lists = []

    for sh in (private, shared):
        for name in names:
            with sh.lock:
                lists.append(sh.shard.query(QueryRequest(
                    query=Query.Nearest(vec[name], using=name),
                    filter=flt,
                    limit=limit * 2,
                    with_payload=True,
                    with_vector=False
                )))

    fused = _rrf(lists)[:limit]
    t_end = time.perf_counter()

    return {
        "results": [{"id": str(p.id), "score": round(s, 4), **p.payload} for p, s in fused],
        "latency_ms": {
            "embed": round((t_embed - t0) * 1000, 1),
            "search": round((t_end - t_embed) * 1000, 1),
            "total": round((t_end - t0) * 1000, 1),
        },
    }
```

### 4.7 Memory Service (`edge/edge/memory/service.py`)
```python
import time, uuid
from qdrant_edge import Point, UpdateOperation
from edge.config import settings
from edge.store.embed import embed_doc
from edge.store.shards import shard_for, private, shared
from edge.events import emit

def now_ms() -> int:
    return int(time.time() * 1000)

def create(text: str, title: str = "", asset_tag: str = "", category: str = "private") -> dict:
    mid, ts = str(uuid.uuid4()), now_ms()
    payload = {
        "memory_id": mid,
        "text": text,
        "title": title,
        "asset_tag": asset_tag,
        "category": category,
        "gate_source": "user",
        "gate_reason": "set manually",
        "pii_hits": [],
        "device_id": settings.device_id,
        "author": settings.author,
        "version": 1,
        "base_version": 0,
        "created_at": ts,
        "updated_at": ts,
        "deleted": False,
        "merged_from": [],
        "sync_state": "pending" if category == "shareable" else "local_only",
    }
    sh = shard_for(category)
    with sh.lock:
        sh.shard.update(UpdateOperation.upsert_points([
            Point(id=mid, vector=embed_doc(text), payload=payload)
        ]))
    emit("memory.created", mid, {"category": category})
    return payload

def get(mid: str):
    for sh in (private, shared):
        with sh.lock:
            recs = sh.shard.retrieve(point_ids=[mid], with_payload=True, with_vector=True)
            if recs:
                return sh, recs[0]
    return None, None
```

---

## 5. Exit Criteria & Verification Tests

```bash
# 1. Turn Wi-Fi OFF completely on the testing laptop
networksetup -setairportpower en0 off   # (macOS command)

# 2. Seed 200 synthetic industrial maintenance notes
python edge/scripts/seed_notes.py --count 200

# 3. Execute test query
curl -X POST http://localhost:7001/search \
  -H "Content-Type: application/json" \
  -d '{"q": "pump vibration after bearing change", "mode": "hybrid", "limit": 5}'

# Verify:
# - Response time (latency_ms.total) is under 50 ms
# - Top 3 results contain the relevant pump fix
# - BM25 accurately matches exact asset tags (e.g. "P-200") that dense search misses

# 4. Crash Recovery (Kill -9 WAL validation)
# Run a loop inserting 50 items, kill -9 the process mid-run:
killall -9 uvicorn
# Restart uvicorn and verify shard loads cleanly with zero corruption and intact records.

# Turn Wi-Fi back ON
networksetup -setairportpower en0 on
```

---

## 6. Readiness for Phase 2 Checklist

- [ ] Hybrid search runs fully offline with zero network attempts.
- [ ] Embedding + search execution finishes in under 50 ms.
- [ ] The two shards (`./data/<device_id>/private` and `./data/<device_id>/shared`) exist on disk.
- [ ] Point IDs are strictly UUIDv4 strings.
