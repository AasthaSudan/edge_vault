import asyncio
import json
import time

_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None

def bind_loop(loop: asyncio.AbstractEventLoop):
    global _loop
    _loop = loop

def emit(type_: str, memory_id: str | None = None, data: dict | None = None):
    ev = {
        "ts": int(time.time() * 1000),
        "type": type_,
        "memory_id": memory_id,
        "data": data or {}
    }
    # Optional DB storage if db module is present
    try:
        from edge import db
        db.execute(
            "INSERT INTO events(ts, type, memory_id, data_json) VALUES (?, ?, ?, ?)",
            (ev["ts"], type_, memory_id, json.dumps(ev["data"]))
        )
    except Exception:
        pass

    if _loop and not _loop.is_closed():
        for q in list(_subscribers):
            _loop.call_soon_threadsafe(q.put_nowait, ev)

def subscribe() -> asyncio.Queue:
    q = asyncio.Queue()
    _subscribers.add(q)
    return q

def unsubscribe(q: asyncio.Queue):
    _subscribers.discard(q)
