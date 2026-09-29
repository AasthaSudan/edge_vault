import re
import time
from edge.config import settings
from edge.store.search import search

ASSET_TAG = re.compile(r"\b[A-Z]{1,10}-\d{1,4}[A-Z]?\b")


def retrieve(question: str, scope: str = "device", prev_question: str | None = None) -> dict:
    """Hybrid RRF retrieval across private + shared (device) or shared only (fleet)."""
    q = question
    if prev_question and len(question.split()) <= 6:
        q = f"{prev_question} {question}"

    k = settings.assistant_top_k
    flt = {"category": "shareable"} if scope == "fleet" else {}
    tag_match = ASSET_TAG.search(q.upper())

    t0 = time.perf_counter()
    results = []
    if tag_match:
        try:
            results = search(q, mode="hybrid", limit=k, asset_tag=tag_match.group(0), **flt)["results"]
        except Exception:
            results = []

    if len(results) < k:
        seen = {r["id"] for r in results}
        try:
            more = search(q, mode="hybrid", limit=k, **flt)["results"]
            results += [r for r in more if r["id"] not in seen]
        except Exception:
            pass

    now = int(time.time() * 1000)
    results = [
        r for r in results
        if not (r.get("expires_at") and r["expires_at"] < now)
        and r.get("gate_source") != "pending"
    ][:k]

    return {"results": results, "ms": round((time.perf_counter() - t0) * 1000, 1)}
