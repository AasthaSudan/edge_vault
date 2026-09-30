import re
import time
import uuid
import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from qdrant_client import QdrantClient, models

from sync_api import corroboration
from sync_api.security import CONFLICTS_DB_PATH

_db_path = Path(CONFLICTS_DB_PATH)
_db_path.parent.mkdir(parents=True, exist_ok=True)
_conn = sqlite3.connect(str(_db_path), check_same_thread=False, isolation_level=None)
_conn.execute("PRAGMA journal_mode=WAL")
_conn.row_factory = sqlite3.Row
_lock = threading.Lock()

def init_db():
    with _lock:
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS server_conflicts (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                local_json TEXT NOT NULL,
                remote_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                resolution TEXT,
                created_at INTEGER NOT NULL
            )
        """)

init_db()

def record(kind: str, item: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    conflict_data = {
        "id": cid,
        "memory_id": item["memory_id"],
        "kind": kind,
        "local": item["point"]["payload"],
        "remote": current,
        "status": "open",
        "created_at": ts
    }
    with _lock:
        _conn.execute(
            "INSERT INTO server_conflicts(id, memory_id, kind, local_json, remote_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (cid, item["memory_id"], kind, json.dumps(conflict_data["local"]), json.dumps(conflict_data["remote"]), ts)
        )
    return conflict_data

CONTRADICTION_MIN_SCORE = 0.80   # same topic; there is deliberately no upper bound: the reports most
                                 # likely to contradict ("25 Nm" vs "20 Nm") are near-identical sentences

# A measured value with a unit: "25 Nm", "4.5 bar", "78C". Numbers without a unit (times, tags,
# counts) are ignored, otherwise "at 10:15" vs "at 14:30" would read as a contradiction.
_UNIT_VALUE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(nm|bar|psi|kpa|mpa|°c|c|°f|f|v|kv|a|ma|kw|w|hz|rpm|mm|cm|m|gpm|lpm|lbs|kg|%)\b", re.I)


def values_differ(a: str, b: str) -> bool:
    """The two reports give different values for the same unit, e.g. {"25"} nm vs {"20"} nm."""
    va, vb = {}, {}
    for text, vals in ((a, va), (b, vb)):
        for num, unit in _UNIT_VALUE.findall(text):
            vals.setdefault(unit.lower().lstrip("°"), set()).add(num)
    return any(va[u] != vb[u] for u in va.keys() & vb.keys())


def check_contradiction(q: QdrantClient, coll: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A NEW note on an asset that another device already reported on, with the same topic but a
    different value or the opposite instruction. It is the counterpart of corroboration: a pair of
    reports is either agreement (fleet verified) or a contradiction for a technician to review."""
    pl = item["point"]["payload"]
    asset_tag = pl.get("asset_tag")
    dense_vec = item["point"]["vector"].get("dense")
    origin_device = pl.get("device_id")

    if not asset_tag or not dense_vec:
        return None

    try:
        # Search for records on same asset_tag from different devices
        flt = models.Filter(
            must=[
                models.FieldCondition(key="asset_tag", match=models.MatchValue(value=asset_tag)),
                models.FieldCondition(key="deleted", match=models.MatchValue(value=False))
            ],
            must_not=[
                models.FieldCondition(key="device_id", match=models.MatchValue(value=origin_device))
            ]
        )
        hits = q.query_points(
            collection_name=coll,
            query=dense_vec,
            using="dense",
            query_filter=flt,
            score_threshold=CONTRADICTION_MIN_SCORE,
            limit=5,
            with_payload=True
        ).points

        local_text = pl.get("text", "")
        for h in hits:
            if str(h.id) == item["memory_id"]:
                continue
            remote_text = h.payload.get("text", "")
            if values_differ(local_text, remote_text) or corroboration.opposed(local_text, remote_text):
                return record("contradiction", item, h.payload)
    except Exception as e:
        print(f"Contradiction check warning: {e}")

    return None


def _row_to_conflict(row) -> Dict[str, Any]:
    return {"id": row["id"], "memory_id": row["memory_id"], "kind": row["kind"],
            "local": json.loads(row["local_json"]), "remote": json.loads(row["remote_json"]),
            "status": row["status"], "created_at": row["created_at"]}


def open_version_conflict(memory_id: str, pushed_by: str) -> Optional[Dict[str, Any]]:
    """An unresolved version conflict on this note that this device's own writes opened."""
    with _lock:
        rows = _conn.execute(
            "SELECT * FROM server_conflicts WHERE memory_id=? AND kind='version' AND status='open' "
            "ORDER BY created_at DESC", (memory_id,)).fetchall()
    for row in rows:
        if json.loads(row["local_json"]).get("pushed_by") == pushed_by:
            return _row_to_conflict(row)
    return None


def refresh_local(conflict: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    """The device edited the note again while its conflict was open. Its newest text becomes the
    "local" side, so that keeping it (or merging) does not silently discard the later edit."""
    with _lock:
        _conn.execute("UPDATE server_conflicts SET local_json=? WHERE id=?", (json.dumps(payload), conflict["id"]))
    return {**conflict, "local": payload}

def resolve(q: QdrantClient, coll: str, conflict_id: str, resolution: str, merged_text: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with _lock:
        row = _conn.execute("SELECT * FROM server_conflicts WHERE id=?", (conflict_id,)).fetchone()
    if not row:
        return None

    local_payload = json.loads(row["local_json"])
    remote_payload = json.loads(row["remote_json"])
    memory_id = row["memory_id"]
    new_version = max(local_payload.get("version", 1), remote_payload.get("version", 1)) + 1
    ts = int(time.time() * 1000)

    if resolution == "keep_local":
        winner_payload = local_payload
    elif resolution == "keep_remote":
        winner_payload = remote_payload
    else:  # merged
        winner_payload = dict(remote_payload)
        if merged_text:
            winner_payload["text"] = merged_text

    winner_payload["version"] = new_version
    winner_payload["updated_at"] = ts

    # Update status in db
    with _lock:
        _conn.execute("UPDATE server_conflicts SET status='resolved', resolution=? WHERE id=?", (resolution, conflict_id))

    return winner_payload
