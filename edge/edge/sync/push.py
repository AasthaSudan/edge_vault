import json
import time
import httpx
from qdrant_edge import UpdateOperation
from edge.config import settings
from edge.store.shards import shared
from edge.sync import outbox
from edge.events import emit
from edge import db

def _mark_synced(rows: list[dict], accepted: set[str]) -> None:
    """Flip sync_state to "synced" for accepted upserts, unless a newer local edit exists."""
    pushed = {r["memory_id"]: r["version"] for r in rows if r["op"] == "upsert" and r["memory_id"] in accepted}
    if not pushed:
        return
    with shared.lock:
        try:
            for rec in shared.shard.retrieve(list(pushed), True, False):
                if rec.payload.get("version") == pushed.get(str(rec.id)):
                    shared.shard.update(UpdateOperation.set_payload([rec.id], {"sync_state": "synced"}))
        except Exception as e:
            print(f"Sync state update notice: {e}")


async def push_once(client: httpx.AsyncClient) -> int:
    rows = outbox.claim(20)
    if not rows:
        return 0

    ids = [r["id"] for r in rows]
    acked = False
    try:
        body = {
            "device_id": settings.device_id,
            "items": [
                {
                    "memory_id": r["memory_id"],
                    "op": r["op"],
                    "point": json.loads(r["point_json"]),
                    "version": r["version"],
                    "base_version": r["base_version"]
                }
                for r in rows
            ]
        }
        resp = await client.post(f"{settings.sync_api_url}/push", json=body, headers=settings.cloud_headers(), timeout=10)
        resp.raise_for_status()
        result = resp.json()  # {"accepted": [...], "conflicts": [...]}

        # Store the conflicts BEFORE acking: a crash in between must not lose them. If this batch is
        # re-sent, the server recognises the open conflict and returns it again.
        conflicts = result.get("conflicts", [])
        for c in conflicts:
            is_new = db.execute("SELECT 1 FROM conflicts WHERE id=?", (c["id"],)).fetchone() is None
            # A device that edits a note again while its conflict is open updates the "local" side
            # (and drops the cached AI analysis, which was about the older text).
            db.execute(
                "INSERT INTO conflicts(id, memory_id, kind, local_json, remote_json, created_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET local_json=excluded.local_json, analysis_json=NULL WHERE conflicts.status='open'",
                (c["id"], c["memory_id"], c["kind"], json.dumps(c["local"]), json.dumps(c["remote"]), c["created_at"])
            )
            if is_new:
                emit("conflict.opened", c["memory_id"], {"kind": c["kind"]})

        outbox.ack(ids)
        acked = True
    except Exception as e:
        # Any failure before the ack (network, a non-JSON reply from a proxy, a bad row) must
        # release the claimed rows, or they stay 'inflight' forever and block pull as well.
        if not acked:
            outbox.fail(ids, str(e))
        emit("sync.push.failed", data={"error": str(e)})
        raise

    _mark_synced(rows, set(result.get("accepted", [])))

    now_ts = int(time.time() * 1000)
    db.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('last_push_at', ?)",
        (str(now_ts),)
    )

    emit("sync.push.ok", data={"accepted": len(result.get("accepted", [])), "conflicts": len(conflicts)})
    return len(rows)
