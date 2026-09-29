import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from edge.assistant import service, sessions
from edge.memory import taint, service as memory_service
from edge import db

router = APIRouter(prefix="/assistant", tags=["Assistant"])


class AskBody(BaseModel):
    question: str
    session_id: str | None = None
    scope: str = "device"          # device | fleet


@router.post("/ask")
def ask(body: AskBody):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Empty question")
    gen = (json.dumps(ev) + "\n" for ev in service.ask(body.session_id, body.question, body.scope))
    return StreamingResponse(gen, media_type="application/x-ndjson")


@router.get("/sessions")
def list_sessions():
    try:
        rows = db.execute(
            "SELECT id, title, scope, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.get("/sessions/{sid}")
def get_session(sid: str):
    session = db.execute("SELECT id, title, scope, created_at, updated_at FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = db.execute(
        "SELECT id, session_id, role, content, sources_json, cited_json, latency_json, created_at FROM chat_messages WHERE session_id=? ORDER BY created_at ASC",
        (sid,)
    ).fetchall()
    return {
        "session": dict(session),
        "messages": [
            {
                **dict(m),
                "sources": json.loads(m["sources_json"]) if m["sources_json"] else [],
                "cited": json.loads(m["cited_json"]) if m["cited_json"] else [],
                "latency": json.loads(m["latency_json"]) if m["latency_json"] else None,
            }
            for m in messages
        ]
    }


@router.delete("/sessions/{sid}")
def delete_session(sid: str):
    db.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
    db.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
    return {"deleted": sid}


@router.post("/messages/{mid}/save")
def save_message_as_memory(mid: str):
    """Save an assistant message as a memory with taint propagation (NFR-10 / FR-30)."""
    row = db.execute(
        "SELECT id, content, sources_json, cited_json FROM chat_messages WHERE id=?",
        (mid,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")

    text = row["content"]
    sources = json.loads(row["sources_json"]) if row["sources_json"] else []
    cited_ids = set(json.loads(row["cited_json"]) if row["cited_json"] else [])

    # Collect source categories: prioritize actually cited sources
    cited_sources = [s for s in sources if s.get("memory_id") in cited_ids] or sources
    source_categories = [s.get("category", "private") for s in cited_sources]

    floor = taint.inherited_floor(source_categories)

    if floor == "private":
        # Force private shard due to taint rule
        saved = memory_service.create(
            text=text,
            title="Assistant Research Note",
            category="private"
        )
        saved["gate_reason"] = "Derived from private notes (taint)"
        return {
            "status": "saved",
            "category": "private",
            "reason": "Derived from private notes (taint)",
            "memory": saved
        }

    # Otherwise let standard gate evaluate (with PII scanning)
    saved = memory_service.create(
        text=text,
        title="Assistant Fact Note"
    )
    return {
        "status": "saved",
        "category": saved.get("category"),
        "reason": saved.get("gate_reason"),
        "memory": saved
    }
