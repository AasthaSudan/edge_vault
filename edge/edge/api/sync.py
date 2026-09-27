import httpx
from fastapi import APIRouter, Query
from edge import db
from edge.sync import outbox, connectivity, push, pull
from edge.events import emit

router = APIRouter(prefix="/sync", tags=["Sync"])

def _get_setting(key: str):
    try:
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else None
    except Exception:
        return None

@router.get("/status")
def status():
    return {
        "forced_offline": connectivity.forced_offline(),
        "outbox_depth": outbox.depth(),
        "last_push_at": _get_setting("last_push_at"),
        "last_pull_at": _get_setting("last_pull_at")
    }

@router.post("/offline")
def set_offline(on: bool = Query(True)):
    db.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('offline_forced', ?)",
        ("1" if on else "0",)
    )
    emit("sync.offline" if on else "sync.online", data={"manual": True})
    return status()

@router.post("/now")
async def sync_now():
    """Trigger an immediate push and pull sync cycle."""
    async with httpx.AsyncClient(timeout=15) as client:
        is_online = await connectivity.online(client)
        if not is_online:
            return {"status": "skipped", "reason": "device is offline or forced offline"}

        pushed = 0
        while True:
            n = await push.push_once(client)
            if n == 0:
                break
            pushed += n

        pulled = await pull.pull_once(client)
        return {"status": "ok", "pushed": pushed, "pulled": pulled}

@router.get("/outbox")
def list_outbox():
    rows = db.execute("SELECT id, memory_id, op, status, version, base_version, attempts, last_error, created_at FROM outbox ORDER BY id DESC LIMIT 50").fetchall()
    return [dict(r) for r in rows]
