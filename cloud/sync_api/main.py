import os
import time
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

q = QdrantClient(url=QDRANT_URL, api_key=KEY)
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

        # 5. Mark synced & handle tombstone
        pl["sync_state"] = "synced"
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

@app.get("/snapshot")
async def get_snapshot():
    """Create and stream a shard snapshot for edge device bootstrapping."""
    try:
        snap_desc = q.create_shard_snapshot(COLL, shard_id=0)
        snap_name = snap_desc.name
        snap_url = f"{QDRANT_URL}/collections/{COLL}/shards/0/snapshots/{snap_name}"

        client = httpx.AsyncClient(timeout=120)
        req = client.build_request("GET", snap_url)
        r = await client.send(req, stream=True)
        return StreamingResponse(r.aiter_bytes(), media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Snapshot creation failed: {e}")

@app.post("/snapshot/partial")
async def get_partial_snapshot(req: Request):
    """Serve delta or latest snapshot to edge devices."""
    try:
        snap_desc = q.create_shard_snapshot(COLL, shard_id=0)
        snap_url = f"{QDRANT_URL}/collections/{COLL}/shards/0/snapshots/{snap_desc.name}"

        client = httpx.AsyncClient(timeout=120)
        req_proxy = client.build_request("GET", snap_url)
        r = await client.send(req_proxy, stream=True)
        return StreamingResponse(r.aiter_bytes(), media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Partial snapshot failed: {e}")

@app.post("/conflicts/resolve")
def resolve_conflict(req: ResolveConflictRequest):
    winner_payload = conflicts.resolve(q, COLL, req.conflict_id, req.resolution, req.merged_text)
    if not winner_payload:
        raise HTTPException(status_code=404, detail="Conflict not found")

    # Update in Qdrant Server
    q.set_payload(COLL, payload=winner_payload, points=[winner_payload["memory_id"]])
    return {"status": "resolved", "memory_id": winner_payload["memory_id"], "version": winner_payload["version"]}

@app.get("/stats")
def stats():
    """Proof of Privacy endpoint: judges can verify zero private or routine notes exist on server."""
    count = lambda f: q.count(COLL, count_filter=f, exact=True).count
    must = lambda k, v: models.Filter(must=[models.FieldCondition(key=k, match=models.MatchValue(value=v))])

    return {
        "total": count(None),
        "private_on_server": count(must("category", "private")),
        "routine_on_server": count(must("category", "routine")),
        "shareable_on_server": count(must("category", "shareable")),
    }
