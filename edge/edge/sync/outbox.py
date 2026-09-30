import json
import time
from typing import List, Dict, Any
from edge import db

def enqueue(memory_id: str, op: str, point: dict, version: int, base_version: int):
    if op == "delete":
        # A retraction supersedes everything still waiting to leave the device. Without this,
        # a note shared and then taken back while offline would still push its full text first.
        db.execute(
            "UPDATE outbox SET status='cancelled' WHERE memory_id=? AND op='upsert' AND status='pending'",
            (memory_id,)
        )
    db.execute(
        "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (memory_id, op, json.dumps(point), version, base_version, int(time.time() * 1000))
    )

def claim(n: int = 20) -> List[Dict[str, Any]]:
    rows = db.execute("SELECT * FROM outbox WHERE status='pending' ORDER BY id LIMIT ?", (n,)).fetchall()
    ids = [r["id"] for r in rows]
    if ids:
        db.execute(f"UPDATE outbox SET status='inflight' WHERE id IN ({','.join('?' * len(ids))})", ids)
    return [dict(r) for r in rows]

def ack(ids: List[int]):
    if ids:
        db.execute(f"UPDATE outbox SET status='done' WHERE id IN ({','.join('?' * len(ids))})", ids)

def fail(ids: List[int], err: str):
    if ids:
        db.execute(
            f"UPDATE outbox SET status='pending', attempts=attempts+1, last_error=? WHERE id IN ({','.join('?' * len(ids))})",
            [err, *ids]
        )

def depth() -> int:
    row = db.execute("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'inflight')").fetchone()
    return row[0] if row else 0

def recover():
    """Startup recovery: reset any inflight records interrupted by a process restart/crash."""
    db.execute("UPDATE outbox SET status='pending' WHERE status='inflight'")
