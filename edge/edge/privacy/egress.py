"""The single door between this device and the cloud outbox (NFR-10)."""
from edge.gate import pii
from edge.sync import outbox
from edge.events import emit
from edge.llm.client import PrivacyError


def _wire(vectors: dict) -> dict:
    """Wire format that Phase 3 push/cloud expect."""
    sp = vectors["bm25"]
    indices = list(sp.indices) if hasattr(sp, "indices") else list(sp.get("indices", []))
    values = list(sp.values) if hasattr(sp, "values") else list(sp.get("values", []))
    return {
        "dense": list(vectors["dense"]),
        "bm25": {"indices": indices, "values": values}
    }


def enqueue_shareable(memory_id: str, vectors: dict, payload: dict,
                      version: int, base_version: int, op: str = "upsert") -> None:
    if payload.get("category") != "shareable":
        emit("privacy.blocked", memory_id, {"why": "non-shareable category"})
        raise PrivacyError("Only shareable memories may be enqueued.")
    hits = pii.scan(f'{payload.get("title", "")} {payload.get("text", "")}')
    if hits and op != "delete":
        emit("privacy.blocked", memory_id, {"why": "pii", "rules": hits})
        raise PrivacyError(f"PII found at egress: {hits}")
    point = {"id": memory_id, "vector": _wire(vectors), "payload": payload}
    outbox.enqueue(memory_id, op, point, version, base_version)
