import json
import numpy as np
from qdrant_edge import Query, QueryRequest, Filter, FieldCondition, MatchValue
from edge import db
from edge.config import settings
from edge.store.shards import private, shared

_EXCLUDE = [
    FieldCondition(key="deleted", match=MatchValue(value=True)),
    FieldCondition(key="gate_source", match=MatchValue(value="pending")),
]


def neighbours(dense: list[float], exclude_id: str | None = None) -> list[dict]:
    """Top-k similar, already-decided notes from BOTH shards. Local reads only."""
    k = settings.gate_context_k
    hits = []
    for sh in (private, shared):
        with sh.lock:
            try:
                hits += sh.shard.query(QueryRequest(
                    query=Query.Nearest(dense, using="dense"),
                    filter=Filter(must_not=_EXCLUDE),
                    limit=k + 1,
                    with_payload=True,
                    with_vector=False,
                ))
            except Exception:
                continue

    hits = [h for h in hits
            if str(h.id) != exclude_id and h.score >= settings.gate_neighbour_min_score]
    hits.sort(key=lambda h: h.score, reverse=True)
    return [{"id": str(h.id), "score": round(h.score, 3), **h.payload} for h in hits[:k]]


def similar_corrections(dense: list[float]) -> list[dict]:
    """Most similar technician corrections (small table: brute-force cosine is fine)."""
    try:
        rows = db.execute(
            "SELECT text, dense_json, model_category, user_category FROM gate_feedback "
            "ORDER BY ts DESC LIMIT 500"
        ).fetchall()
    except Exception:
        return []

    if not rows:
        return []
    q = np.asarray(dense, dtype=np.float32)
    q /= np.linalg.norm(q) + 1e-9
    scored = []
    for r in rows:
        try:
            v = np.asarray(json.loads(r["dense_json"]), dtype=np.float32)
            s = float(q @ (v / (np.linalg.norm(v) + 1e-9)))
            if s >= 0.60:
                scored.append((s, dict(r)))
        except Exception:
            continue
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[: settings.gate_corrections_k]]
