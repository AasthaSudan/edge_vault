import os
import time
import threading
from typing import Optional
import httpx
from dotenv import load_dotenv
load_dotenv()

import contextlib
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client import QdrantClient, models
from sync_api.models import PushBody, ResolveConflictRequest
from sync_api import conflicts, corroboration
from sync_api.bootstrap import ensure_collection
from sync_api.security import CORS_ORIGINS, ENV, require_fleet_key

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
KEY = os.getenv("QDRANT_API_KEY") or None
COLL = "shared_memory"

# Use generous timeout for snapshot operations
q = QdrantClient(url=QDRANT_URL, api_key=KEY, timeout=120)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_collection(q)  # idempotent: a fresh deployment needs no manual init step
    yield


app = FastAPI(title="EdgeVault Cloud Sync API", version="0.2.0", lifespan=lifespan,
              docs_url=None if ENV == "production" else "/docs", redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,  # auth is a bearer header, never cookies
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

FLEET = [Depends(require_fleet_key)]


@app.get("/health")
def health():
    """Liveness + Qdrant reachability (used by container health checks and edge connectivity)."""
    try:
        q.get_collection(COLL)
    except Exception as e:
        return JSONResponse(status_code=503, content={"ok": False, "service": "edgevault-cloud-sync",
                                                      "error": f"qdrant unavailable: {type(e).__name__}"})
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

TOMBSTONE_FIELDS = ("memory_id", "asset_tag", "device_id", "author", "version",
                    "base_version", "created_at", "updated_at")


def _as_tombstone(item) -> None:
    """A retraction never carries content. Whatever the client sent, the server stores an empty,
    deleted, shareable-shaped record with a constant vector, so a `delete` can neither smuggle a
    private note past the category guard nor leave the retracted text (or its embedding) in the fleet."""
    pl = item.point["payload"]
    tomb = {k: pl[k] for k in TOMBSTONE_FIELDS if k in pl}
    tomb.update(category="shareable", deleted=True, text="", title="")
    item.point["payload"] = tomb
    dim = len(item.point.get("vector", {}).get("dense") or [])
    if dim:
        item.point["vector"] = {"dense": [dim ** -0.5] * dim, "bm25": {"indices": [], "values": []}}


@app.post("/push", dependencies=FLEET)
def push(body: PushBody):
    accepted, found_conflicts = [], []
    for item in body.items:
        if item.op == "delete":
            _as_tombstone(item)
        pl = item.point["payload"]
        pl["pushed_by"] = body.device_id  # which device wrote this version (audit, and owner of any conflict)

        # 1. Defense-in-depth security guard: Never accept non-shareable memories. A delete is
        # always rewritten to a tombstone above, so it carries no content to guard.
        if pl.get("category") != "shareable":
            raise HTTPException(status_code=400, detail="Security violation: only shareable memories may be pushed to fleet")

        # 2. Check for existing version in Qdrant
        existing = q.retrieve(COLL, ids=[item.memory_id], with_payload=True, with_vectors=False)
        cur = existing[0].payload if existing else None

        # 3. Idempotent repeat: the SAME content at the same version (a retried push).
        # Comparing the author device is not enough: another device editing this note sends
        # the same author and version number with different text, and must hit step 4.
        if (cur and cur.get("version") == item.version
                and cur.get("text") == pl.get("text") and bool(cur.get("deleted")) == bool(pl.get("deleted"))):
            accepted.append(item.memory_id)
            continue

        # 3b. This device already has an unresolved conflict on this note (e.g. it edited twice offline
        # and the first edit was rejected). A follow-up edit is based on a version the server refused,
        # so accepting it would silently overwrite the other device's edit. It joins the open conflict:
        # the newest text becomes the "local" side for the technician to keep or merge.
        if cur:
            open_conflict = conflicts.open_version_conflict(item.memory_id, body.device_id)
            if open_conflict:
                open_conflict = conflicts.refresh_local(open_conflict, pl)
                # one entry per conflict, carrying the newest local text
                found_conflicts[:] = [c for c in found_conflicts if c["id"] != open_conflict["id"]] + [open_conflict]
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
        else:
            # Cross-device corroboration: "Fleet Verified" when independent devices agree
            corroboration.apply(q, COLL, pl, item.point["vector"].get("dense"), cur, _server_ts)

        q.upsert(COLL, points=[to_point(item.point)])
        accepted.append(item.memory_id)

        # 6. Check for a contradicting report if this note is new to the server (a note shared later by
        # a category override arrives with base_version > 0 but is just as new; a tombstone has nothing to contradict)
        if cur is None and item.op != "delete":
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


@app.get("/pull/records", dependencies=FLEET)
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

@app.get("/snapshot", dependencies=FLEET)
async def get_snapshot():
    return await _stream_latest_or_new_snapshot()

@app.post("/snapshot/partial", dependencies=FLEET)
async def get_partial_snapshot(req: Request):
    return await _stream_latest_or_new_snapshot()

@app.post("/conflicts/resolve", dependencies=FLEET)
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
        "fleet_verified_on_server": count(must("fleet_verified", True)),
    }
