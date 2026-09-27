import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from qdrant_edge import ScrollRequest, Filter, FieldCondition, MatchValue

from edge.config import settings
from edge import db, events
from edge.store import embed, shards
from edge.gate import gate
from edge.sync import worker
from edge.api import memories, search, sync, conflicts, stream

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database
    db.init()
    # Bind running asyncio loop to event emitter
    events.bind_loop(asyncio.get_running_loop())

    # Pre-warm embedding model and gate to eliminate cold-start latency
    try:
        embed.embed_query("warm up query")
        gate.decide("warm up note for classifier")
    except Exception as e:
        print(f"Warmup warning: {e}")

    # Launch background sync worker
    sync_task = asyncio.create_task(worker.run())
    yield

    # Clean shutdown
    sync_task.cancel()
    shards.private.close()
    shards.shared.close()

app = FastAPI(
    title="EdgeVault Edge Node",
    description="Offline-first semantic memory for industrial field technicians",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(memories.router)
app.include_router(search.router)
app.include_router(sync.router)
app.include_router(conflicts.router)
app.include_router(stream.router)

@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "ok",
        "device_id": settings.device_id,
        "author": settings.author,
        "mode": "offline-edge",
        "shards": {
            "private": str(shards.private.path),
            "shared": str(shards.shared.path),
        }
    }

@app.get("/stats/local", tags=["Health"])
def local_stats():
    """Counts across local shards."""
    def count_shard(sh):
        with sh.lock:
            recs, _ = sh.shard.scroll(ScrollRequest(limit=5000, with_payload=True, with_vector=False))
            active = [r for r in recs if not r.payload.get("deleted", False)]
            return active

    priv_recs = count_shard(shards.private)
    shared_recs = count_shard(shards.shared)

    counts = {
        "device_id": settings.device_id,
        "author": settings.author,
        "total": len(priv_recs) + len(shared_recs),
        "private": len([r for r in priv_recs if r.payload.get("category") == "private"]),
        "routine": len([r for r in priv_recs if r.payload.get("category") == "routine"]),
        "shareable": len(shared_recs),
    }
    return counts
