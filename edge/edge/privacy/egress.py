"""The single door between this device and the cloud outbox (NFR-10)."""
from edge.config import settings
from edge.gate import pii
from edge.sync import outbox
from edge.events import emit
from edge.llm.client import PrivacyError


def _wire(vectors: dict) -> dict:
    """Wire format that the push worker and cloud API expect."""
    sp = vectors["bm25"]
    indices = list(sp.indices) if hasattr(sp, "indices") else list(sp.get("indices", []))
    values = list(sp.values) if hasattr(sp, "values") else list(sp.get("values", []))
    return {
        "dense": list(vectors["dense"]),
        "bm25": {"indices": indices, "values": values}
    }


TOMBSTONE_FIELDS = ("memory_id", "asset_tag", "device_id", "author", "version",
                    "base_version", "created_at", "updated_at")


def _neutral_wire() -> dict:
    """Vectors for a tombstone: constant, so they say nothing about the retracted text
    (a dense embedding and BM25 token hashes of that text would otherwise still leak it)."""
    dim = settings.dense_dim
    return {"dense": [dim ** -0.5] * dim, "bm25": {"indices": [], "values": []}}


def _tombstone(payload: dict) -> dict:
    """A delete/retraction carries no content: it overwrites the cloud copy with an
    empty, deleted record, so retracted text is erased from the fleet too."""
    t = {k: payload[k] for k in TOMBSTONE_FIELDS if k in payload}
    t.update(category="shareable", deleted=True, text="", title="")
    return t


def enqueue_shareable(memory_id: str, vectors: dict, payload: dict,
                      version: int, base_version: int, op: str = "upsert") -> None:
    if payload.get("category") != "shareable":
        emit("privacy.blocked", memory_id, {"why": "non-shareable category"})
        raise PrivacyError("Only shareable memories may be enqueued.")
    if op == "delete":
        payload = _tombstone(payload)
    hits = pii.scan(f'{payload.get("title", "")} {payload.get("text", "")} {payload.get("asset_tag", "")}')
    if hits:
        emit("privacy.blocked", memory_id, {"why": "pii", "rules": hits})
        raise PrivacyError(f"PII found at egress: {hits}")
    if pii.scan(str(payload.get("gate_reason", ""))):
        # The reason is written by the local LLM from a prompt that includes neighbouring (possibly
        # private) notes; if it echoes anything sensitive the note is still shared, without that reason.
        payload = {**payload, "gate_reason": "Classified on device"}
    point = {"id": memory_id, "vector": _neutral_wire() if op == "delete" else _wire(vectors), "payload": payload}
    outbox.enqueue(memory_id, op, point, version, base_version)
