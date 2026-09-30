import os
import time
import threading
from typing import Optional
import httpx
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client import QdrantClient, models
from sync_api.models import PushBody, ResolveConflictRequest
from sync_api import conflicts

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
KEY = os.getenv("QDRANT_API_KEY", None)
COLL = "shared_memory"

# Use generous timeout for snapshot operations
q = QdrantClient(url=QDRANT_URL, api_key=KEY, timeout=120)
app = FastAPI(title="EdgeVault Cloud Sync API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "service": "edgevault-cloud-sync"}

def to_point(p: dict) -> models.PointStruct:
    v = p["vector"]
    sparse_v = v.get("bm25")
    if isinstance(sparse_v, dict):
        bm25_indices = sparse_v["indices"]
        bm25_values = sparse_v["values"]
    else:
        bm25_indices = list(sparse_v.indices)
        bm25_values = list(sparse_v.values)

    return models.PointStruct(
        id=p["id"],
        payload=p["payload"],
        vector={
            "dense": v["dense"],
            "bm25": models.SparseVector(indices=bm25_indices, values=bm25_values)
        }
    )

@app.post("/push")
def push(body: PushBody):
    accepted, found_conflicts = [], []
    for item in body.items:
        pl = item.point["payload"]

        # 1. Defense-in-depth security guard: Never accept non-shareable memories (unless it is a delete retraction)
        if item.op != "delete" and pl.get("category") != "shareable":
            raise HTTPException(status_code=400, detail="Security violation: only shareable memories may be pushed to fleet")

        # 2. Check for existing version in Qdrant
        existing = q.retrieve(COLL, ids=[item.memory_id], with_payload=True, with_vectors=False)
        cur = existing[0].payload if existing else None

        # 3. Idempotent repeat: same version from same device
        if cur and cur.get("version") == item.version and cur.get("device_id") == pl.get("device_id"):
            accepted.append(item.memory_id)
            continue

        # 4. Version Conflict: server has a newer version from another edit
        if cur and cur.get("version", 0) > item.base_version:
            found_conflicts.append(conflicts.record("version", item.model_dump(), cur))
            continue

        # 5. Mark synced & handle tombstone. server_ts is the SERVER's clock: edges pull
        # by it, so a note edited offline yesterday and pushed today is still delivered.
        pl["sync_state"] = "synced"
        pl["server_ts"] = _server_ts()
        if item.op == "delete":
            pl["deleted"] = True

        q.upsert(COLL, points=[to_point(item.point)])
        accepted.append(item.memory_id)

        # 6. Check for semantic contradiction if first insertion
        if item.base_version == 0:
            c = conflicts.check_contradiction(q, COLL, item.model_dump())
            if c:
                found_conflicts.append(c)

    return {"accepted": accepted, "conflicts": found_conflicts}

_ts_lock = threading.Lock()
_last_ts = 0


def _server_ts() -> int:
    """Strictly increasing server-clock timestamp (ms)."""
    global _last_ts
    with _ts_lock:
        _last_ts = max(int(time.time() * 1000), _last_ts + 1)
        return _last_ts


@app.get("/pull/records")
def pull_records(since_ts: int = 0, limit: int = 100, offset: Optional[str] = None):
    """Paged delta sync for edge devices, keyed on the server clock (server_ts).

    since_ts=0 is a full pull (also returns records pushed before server_ts existed).
    Page with `next_offset` until it is null, then pull next time from `server_now`."""
    must = [models.FieldCondition(key="category", match=models.MatchValue(value="shareable"))]
    if since_ts > 0:
        must.append(models.FieldCondition(key="server_ts", range=models.Range(gte=since_ts)))
    server_now = int(time.time() * 1000)
    records, next_offset = q.scroll(
        collection_name=COLL,
        scroll_filter=models.Filter(must=must),
        limit=min(limit, 500),
        offset=offset,
        with_payload=True,
        with_vectors=True
    )
    points_out = [{"id": r.id, "payload": r.payload, "vector": r.vector} for r in records]
    return {
        "records": points_out,
        "count": len(points_out),
        "next_offset": str(next_offset) if next_offset is not None else None,
        "server_now": server_now,
    }

async def _stream_latest_or_new_snapshot():
    """Retrieve the latest ready shard snapshot, or initiate a new one."""
    client = httpx.AsyncClient(timeout=120)
    try:
        snaps_resp = await client.get(f"{QDRANT_URL}/collections/{COLL}/shards/0/snapshots")
        snaps = snaps_resp.json().get("result", []) if snaps_resp.status_code == 200 else []

        snap_name = None
        if snaps:
            snap_name = snaps[0]["name"]
        else:
            snap_desc = q.create_shard_snapshot(COLL, shard_id=0)
            snap_name = snap_desc.name

        snap_url = f"{QDRANT_URL}/collections/{COLL}/shards/0/snapshots/{snap_name}"
        req = client.build_request("GET", snap_url)
        r = await client.send(req, stream=True)
        return StreamingResponse(r.aiter_bytes(), media_type="application/octet-stream")
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=500, detail=f"Snapshot retrieval failed: {e}")

@app.get("/snapshot")
async def get_snapshot():
    return await _stream_latest_or_new_snapshot()

@app.post("/snapshot/partial")
async def get_partial_snapshot(req: Request):
    return await _stream_latest_or_new_snapshot()

@app.post("/conflicts/resolve")
def resolve_conflict(req: ResolveConflictRequest):
    winner_payload = conflicts.resolve(q, COLL, req.conflict_id, req.resolution, req.merged_text)
    if not winner_payload:
        raise HTTPException(status_code=404, detail="Conflict not found")

    winner_payload["server_ts"] = _server_ts()  # so the fleet pulls the resolved version
    q.set_payload(COLL, payload=winner_payload, points=[winner_payload["memory_id"]])
    return {"status": "resolved", "memory_id": winner_payload["memory_id"], "version": winner_payload["version"]}

@app.get("/stats")
def stats():
    count = lambda f: q.count(COLL, count_filter=f, exact=True).count
    must = lambda k, v: models.Filter(must=[models.FieldCondition(key=k, match=models.MatchValue(value=v))])

    return {
        "total": count(None),
        "private_on_server": count(must("category", "private")),
        "routine_on_server": count(must("category", "routine")),
        "shareable_on_server": count(must("category", "shareable")),
    }
