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

    names = {"hybrid": ["dense", "bm25"], "dense": ["dense"], "bm25": ["bm25"]}.get(mode, ["dense", "bm25"])
    flt = _filter(**filters)
    lists = []

    for sh in (private, shared):
        for name in names:
            with sh.lock:
                lists.append(sh.shard.query(QueryRequest(
                    query=Query.Nearest(vec[name], using=name),
                    filter=flt,
                    limit=limit * 2,
                    with_payload=True
                )))

    fused = _rrf(lists)
    # Defense-in-depth: exclude any tombstoned/deleted points
    active_results = [
        {"id": str(p.id), "score": round(s, 4), **p.payload}
        for p, s in fused
        if not p.payload.get("deleted", False)
    ][:limit]
    t_end = time.perf_counter()

    return {
        "results": active_results,
        "latency_ms": {
            "embed": round((t_embed - t0) * 1000, 1),
            "search": round((t_end - t_embed) * 1000, 1),
            "total": round((t_end - t0) * 1000, 1),
        },
    }
