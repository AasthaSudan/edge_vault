import os
import contextlib
import threading
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from qdrant_edge import ScrollRequest, Filter, FieldCondition, MatchValue
import asyncio

from edge.config import settings
from edge import events
from edge.store import shards
from edge.api import memories, search, sync, conflicts, stream, assistant, suggestions, llm
from edge.sync import worker as sync_worker
from edge.memory.ttl import sweep_expired_routine
from edge.assistant import sessions
from edge.llm import client as llm_client
from edge.gate import worker as gate_worker
from edge.store.embed import embed_query


def _warmup():
    """Load the embedding models and the LLM into RAM so the first search / first note
    is not a cold start. Runs off the startup path: the API answers immediately
    instead of waiting for Ollama to load the model (seconds on a cold CPU)."""
    try:
        embed_query("warmup")
    except Exception as e:
        print(f"Embedder warmup notice: {e}")
    llm_client.warmup()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure clean directory setup and start background tasks
    settings.dir.mkdir(parents=True, exist_ok=True)

    # emit() runs on worker threads; it hands events to /events subscribers through this loop.
    # Without it the SSE feed only ever sends keep-alives.
    events.bind_loop(asyncio.get_running_loop())

    # 1. Warm up embedder + LLM in the background and start gate worker
    threading.Thread(target=_warmup, name="warmup", daemon=True).start()
    gate_worker.start()

    # 2. Start background sync engine
    sync_task = asyncio.create_task(sync_worker.run())
    
    # 3. Start routine memory TTL pruner & chat retention (runs every 60 minutes)
    async def ttl_loop():
        while True:
            try:
                sweep_expired_routine()
                sessions.sweep()
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

class BlockCrossSiteWrites:
    """Reject state-changing requests that a browser sends from a page that is not the local dashboard.

    CORS only stops a page from READING a response. A "simple" POST (no body, no custom header) such as
    /sync/offline is still delivered and executed. Browsers always attach an Origin header to cross-site
    writes, so a write from any origin other than the dashboard is refused. Requests without Origin
    (curl, scripts, the Python clients used by the demo and tests) are not browser cross-site requests."""

    def __init__(self, app, allowed_origins: list[str]):
        self.app = app
        self.allowed = set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] not in ("GET", "HEAD", "OPTIONS"):
            origin = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"origin"), None)
            if origin is not None and origin not in self.allowed:
                await JSONResponse({"detail": "Cross-origin write blocked"}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_host_list)
app.add_middleware(BlockCrossSiteWrites, allowed_origins=settings.cors_origin_list)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,  # the local dashboard only (see config.cors_origins)
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

# Routers already define their own prefixes in their router modules
app.include_router(memories.router)
app.include_router(search.router)
app.include_router(sync.router)
app.include_router(conflicts.router)
app.include_router(stream.router)
app.include_router(assistant.router)
app.include_router(suggestions.router)
app.include_router(llm.router)

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
