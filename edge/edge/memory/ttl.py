import time
import asyncio
from qdrant_edge import ScrollRequest, Filter, FieldCondition, MatchValue, UpdateOperation
from edge.store.shards import private
from edge.events import emit

def now_ms() -> int:
    return int(time.time() * 1000)

def sweep_expired_routine() -> int:
    """Scan private shard for routine memories whose expires_at is past and remove them."""
    current_time = now_ms()
    flt = Filter(must=[
        FieldCondition(key="category", match=MatchValue(value="routine")),
        FieldCondition(key="deleted", match=MatchValue(value=False))
    ])

    expired_ids = []
    with private.lock:
        recs, _ = private.shard.scroll(ScrollRequest(
            limit=500,
            filter=flt,
            with_payload=True,
            with_vector=False
        ))
        for r in recs:
            exp = r.payload.get("expires_at")
            if exp and exp <= current_time:
                expired_ids.append(r.id)

        if expired_ids:
            private.shard.update(UpdateOperation.delete_points(expired_ids))

    if expired_ids:
        emit("ttl.expired", None, {"count": len(expired_ids), "ids": [str(x) for x in expired_ids]})

    return len(expired_ids)

async def start_ttl_sweeper(interval_seconds: int = 600):
    """Background task running every 10 minutes."""
    while True:
        try:
            sweep_expired_routine()
        except Exception as e:
            print(f"Error in TTL sweep: {e}")
        await asyncio.sleep(interval_seconds)
