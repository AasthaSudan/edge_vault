import time
import asyncio
from qdrant_edge import ScrollRequest, Filter, FieldCondition, MatchValue, UpdateOperation
from edge.store.shards import private
from edge.events import emit

_PAGE = 500  # points per scroll call

def now_ms() -> int:
    return int(time.time() * 1000)

def sweep_expired_routine() -> int:
    """Scan private shard for routine memories whose expires_at is past and remove them."""
    current_time = now_ms()
    # Do not filter on `deleted`: MatchValue on a bool never matches in Qdrant Edge, so a
    # `deleted == False` condition selects nothing and no routine note would ever expire.
    flt = Filter(must=[FieldCondition(key="category", match=MatchValue(value="routine"))])

    expired_ids = []
    next_offset = None
    while True:  # page through every routine note, not just the first page
        with private.lock:
            recs, next_offset = private.shard.scroll(ScrollRequest(
                offset=next_offset,
                limit=_PAGE,
                filter=flt,
                with_payload=True,
                with_vector=False
            ))
        for r in recs:
            exp = r.payload.get("expires_at")
            if exp and exp <= current_time and not r.payload.get("deleted", False):
                expired_ids.append(r.id)
        if next_offset is None or not recs:
            break

    if expired_ids:
        with private.lock:
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
