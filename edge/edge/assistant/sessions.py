import json
import time
import uuid
from edge import db
from edge.config import settings


def _now():
    return int(time.time() * 1000)


def create(title: str, scope: str = "device") -> str:
    sid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO chat_sessions(id, title, scope, created_at, updated_at) VALUES (?,?,?,?,?)",
        (sid, title, scope, _now(), _now())
    )
    return sid


def add(session_id: str, role: str, content: str, sources=None, cited=None, latency=None) -> str:
    mid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO chat_messages(id, session_id, role, content, sources_json, cited_json, latency_json, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (mid, session_id, role, content, json.dumps(sources), json.dumps(cited), json.dumps(latency), _now()),
    )
    db.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?", (_now(), session_id))
    return mid


def history(session_id: str) -> list[dict]:
    try:
        rows = db.execute(
            "SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at",
            (session_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def sweep():
    """Retention: cleans up sessions older than settings.chat_retention_days."""
    try:
        cutoff = _now() - (settings.chat_retention_days * 86_400_000)
        old = [r[0] for r in db.execute("SELECT id FROM chat_sessions WHERE updated_at < ?", (cutoff,)).fetchall()]
        for sid in old:
            db.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
            db.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
    except Exception:
        pass
