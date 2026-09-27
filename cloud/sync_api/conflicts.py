import time
import uuid
import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from qdrant_client import QdrantClient, models

_db_path = Path("./data/cloud_conflicts.db")
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

def check_contradiction(q: QdrantClient, coll: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Heuristic / semantic contradiction check on server for items on the same asset_tag."""
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
            limit=3,
            with_payload=True
        ).points

        for h in hits:
            # Score between 0.80 and 0.95: high similarity, check for contradictory instructions
            if 0.80 <= h.score <= 0.95:
                remote_text = h.payload.get("text", "").lower()
                local_text = pl.get("text", "").lower()
                # Check for antonyms or contradictory indicators
                contradiction_words = [("replace", "repaired"), ("high", "low"), ("normal", "failed"), ("20", "25"), ("not", "is")]
                is_contradiction = any((w1 in local_text and w2 in remote_text) or (w2 in local_text and w1 in remote_text) for w1, w2 in contradiction_words)
                if is_contradiction:
                    return record("contradiction", item, h.payload)
    except Exception as e:
        print(f"Contradiction check warning: {e}")

    return None

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
