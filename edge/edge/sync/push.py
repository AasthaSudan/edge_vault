import json
import time
import httpx
from edge.config import settings
from edge.sync import outbox
from edge.events import emit
from edge import db

async def push_once(client: httpx.AsyncClient) -> int:
    rows = outbox.claim(20)
    if not rows:
        return 0

    ids = [r["id"] for r in rows]
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

    try:
        resp = await client.post(f"{settings.sync_api_url}/push", json=body, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        outbox.fail(ids, str(e))
        emit("sync.push.failed", data={"error": str(e)})
        raise

    result = resp.json()  # {"accepted": [...], "conflicts": [...]}
    outbox.ack(ids)

    # Ingest conflicts returned by server into local conflicts table
    conflicts = result.get("conflicts", [])
    for c in conflicts:
        db.execute(
            "INSERT OR IGNORE INTO conflicts(id, memory_id, kind, local_json, remote_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (c["id"], c["memory_id"], c["kind"], json.dumps(c["local"]), json.dumps(c["remote"]), c["created_at"])
        )
        emit("conflict.opened", c["memory_id"], {"kind": c["kind"]})

    now_ts = int(time.time() * 1000)
    db.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('last_push_at', ?)",
        (str(now_ts),)
    )

    emit("sync.push.ok", data={"accepted": len(result.get("accepted", [])), "conflicts": len(conflicts)})
    return len(rows)
