import httpx
from edge import db
from edge.config import settings

def forced_offline() -> bool:
    try:
        row = db.execute("SELECT value FROM settings WHERE key='offline_forced'").fetchone()
        return bool(row and row[0] == "1")
    except Exception:
        return False

async def online(client: httpx.AsyncClient) -> bool:
    if forced_offline():
        return False
    try:
        r = await client.get(f"{settings.sync_api_url}/health", timeout=1.5)
        return r.status_code == 200
    except Exception:
        return False
