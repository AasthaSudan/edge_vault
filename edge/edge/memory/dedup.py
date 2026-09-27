from typing import Optional
from qdrant_edge import Query, QueryRequest, Filter, FieldCondition, MatchValue
from edge.config import settings

def find_duplicate(shard, dense: list[float], asset_tag: str = "") -> Optional[object]:
    """Search for near-duplicates in the target shard with cosine similarity >= dedup_threshold."""
    must = [FieldCondition(key="asset_tag", match=MatchValue(value=asset_tag))] if asset_tag else None
    flt = Filter(must=must, must_not=[FieldCondition(key="deleted", match=MatchValue(value=True))])

    with shard.lock:
        try:
            hits = shard.shard.query(QueryRequest(
                query=Query.Nearest(dense, using="dense"),
                filter=flt,
                limit=1,
                with_payload=True
            ))
            if hits and len(hits) > 0 and hits[0].score >= settings.dedup_threshold:
                # Extra check: make sure hit is not deleted
                if not hits[0].payload.get("deleted", False):
                    return hits[0]
        except Exception:
            return None

    return None
