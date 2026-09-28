import os
import contextlib
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from qdrant_edge import ScrollRequest, Filter, FieldCondition, MatchValue
import asyncio

from edge.config import settings
from edge.store import shards
from edge.api import memories, search, sync, conflicts, stream
from edge.sync import worker as sync_worker
from edge.memory.ttl import sweep_expired_routine

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure clean directory setup and start background tasks
    settings.dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Start background sync engine
    sync_task = asyncio.create_task(sync_worker.run())
    
    # 2. Start routine memory TTL pruner (runs every 60 minutes)
    async def ttl_loop():
        while True:
            try:
                sweep_expired_routine()
            except Exception as e:
                print(f"TTL prune warning: {e}")
            await asyncio.sleep(3600)
    ttl_task = asyncio.create_task(ttl_loop())

    yield

    # Shutdown: clean up background workers and close shards
    sync_task.cancel()
    ttl_task.cancel()
    try:
        await asyncio.gather(sync_task, ttl_task, return_exceptions=True)
    except Exception:
        pass
    shards.private.close()
    shards.shared.close()

app = FastAPI(
    title=f"EdgeVault Node ({settings.device_id})",
    description="Offline-first semantic memory engine on Qdrant Edge",
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

# Routers already define their own prefixes in their router modules
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
            try:
                if not hasattr(sh, "shard") or sh.shard is None:
                    return []
                recs, _ = sh.shard.scroll(ScrollRequest(limit=5000, with_payload=True, with_vector=False))
                active = [r for r in recs if not r.payload.get("deleted", False)]
                return active
            except Exception as e:
                print(f"Stats scroll notice: {e}")
                return []

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
