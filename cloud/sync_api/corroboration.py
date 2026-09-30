"""Cross-device corroboration ("Fleet Verified").

A shareable note is corroborated when an independent device reports the same fact about the
same asset: dense cosine >= CORROBORATION_MIN_SCORE, same asset_tag, different device, and no
disagreement in values or instructions (that would be a contradiction, not agreement).

Payload fields (on every point):
  corroborated_by:     sorted device ids that reported this fact (always includes the author)
  corroboration_count: len(corroborated_by)
  fleet_verified:      corroboration_count >= 2
"""
import os
import re
from qdrant_client import QdrantClient, models

MIN_SCORE = float(os.getenv("CORROBORATION_MIN_SCORE", "0.88"))

_NUM = re.compile(r"\d+(?:\.\d+)?")
_OPPOSITES = [("open", "closed"), ("on", "off"), ("increase", "decrease"), ("raise", "lower"),
              ("enable", "disable"), ("normal", "failed"), ("high", "low"), ("clockwise", "counterclockwise")]


def devices(payload: dict | None) -> set[str]:
    if not payload:
        return set()
    devs = set(payload.get("corroborated_by") or [])
    if payload.get("device_id"):
        devs.add(payload["device_id"])
    return devs


def fields(devs: set[str]) -> dict:
    return {"corroborated_by": sorted(devs), "corroboration_count": len(devs), "fleet_verified": len(devs) >= 2}


def disagree(a: str, b: str) -> bool:
    """Same topic but different values or opposite wording: not corroboration."""
    na, nb = set(_NUM.findall(a)), set(_NUM.findall(b))
    if na and nb and na != nb:
        return True
    wa, wb = set(re.findall(r"[a-z]+", a.lower())), set(re.findall(r"[a-z]+", b.lower()))
    return any((x in wa and y in wb) or (y in wa and x in wb) for x, y in _OPPOSITES)


def find_independent(q: QdrantClient, coll: str, payload: dict, dense: list[float]) -> list:
    """Existing fleet notes from OTHER devices that report the same fact about the same asset."""
    must = [
        models.FieldCondition(key="category", match=models.MatchValue(value="shareable")),
        models.FieldCondition(key="deleted", match=models.MatchValue(value=False)),
    ]
    if payload.get("asset_tag"):
        must.append(models.FieldCondition(key="asset_tag", match=models.MatchValue(value=payload["asset_tag"])))
    hits = q.query_points(
        collection_name=coll,
        query=dense,
        using="dense",
        query_filter=models.Filter(
            must=must,
            must_not=[models.FieldCondition(key="device_id", match=models.MatchValue(value=payload.get("device_id", "")))],
        ),
        score_threshold=MIN_SCORE,
        limit=5,
        with_payload=True,
    ).points
    text = payload.get("text", "")
    return [h for h in hits if str(h.id) != payload.get("memory_id") and not disagree(text, h.payload.get("text", ""))]


def apply(q: QdrantClient, coll: str, payload: dict, dense: list[float] | None, current: dict | None, stamp) -> list[str]:
    """Update `payload` (in place) and any independent matches. Returns matched point ids.

    - Keeps every device already recorded on the server copy (an edit never drops corroboration)
    - Adds devices the edge declared (it merged its own report into this note)
    - Links a NEW note to near-identical notes from other devices, both ways
    """
    devs = devices(payload) | devices(current)
    matched = []
    if current is None and dense:
        for h in find_independent(q, coll, payload, dense):
            devs |= devices(h.payload)
            h_devs = devices(h.payload) | {payload.get("device_id")}
            # server_ts moves so every edge pulls the updated corroboration
            q.set_payload(coll, payload={**fields(h_devs), "server_ts": stamp()}, points=[h.id])
            matched.append(str(h.id))
    payload.update(fields(devs))
    return matched
