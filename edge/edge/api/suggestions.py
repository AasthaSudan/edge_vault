import json
import time
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query
from edge import db
from edge.gate import pii, sanitize
from edge.memory import service as memory_service
from edge.events import emit

router = APIRouter(prefix="/suggestions", tags=["Suggestions"])


class ApproveSuggestionBody(BaseModel):
    text: Optional[str] = None


@router.get("")
def list_suggestions(status: Optional[str] = Query("pending")):
    query = "SELECT id, source_memory_id, proposed_text, asset_tag, checks_json, status, derived_memory_id, created_at, decided_at FROM share_suggestions"
    params = []
    if status:
        query += " WHERE status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT 50"

    rows = db.execute(query, tuple(params)).fetchall()
    result = []
    for r in rows:
        item = dict(r)
        item["checks"] = json.loads(item["checks_json"]) if item["checks_json"] else {}

        # Fetch source memory text and mask PII
        _, rec = memory_service.get(item["source_memory_id"])
        source_text = rec.payload.get("text", "") if rec else ""
        source_title = rec.payload.get("title", "") if rec else ""

        # Mask access codes / pins for privacy UI
        import re
        masked_text = re.sub(r'\b\d{4,8}\b', '████', source_text)
        item["masked_text"] = masked_text
        item["source_text"] = source_text
        item["source_title"] = source_title
        result.append(item)

    return result


@router.post("/{sid}/approve")
def approve_suggestion(sid: str, body: ApproveSuggestionBody = None):
    row = db.execute(
        "SELECT id, source_memory_id, proposed_text, asset_tag, checks_json, status FROM share_suggestions WHERE id = ?",
        (sid,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Suggestion is already {row['status']}")

    approved_text = (body.text.strip() if body and body.text else row["proposed_text"]).strip()

    # Re-verify PII and grounding on any manual edit
    hits = pii.scan(approved_text)
    if hits:
        raise HTTPException(status_code=400, detail=f"Approved text contains sensitive patterns: {hits}")

    # Create approved shareable memory
    now_ts = int(time.time() * 1000)
    created = memory_service.create(
        text=approved_text,
        title=f"Fleet SOP: {row['asset_tag'] or 'Equipment Fix'}",
        asset_tag=row["asset_tag"] or "",
        category="shareable"
    )

    db.execute(
        "UPDATE share_suggestions SET status='approved', derived_memory_id=?, decided_at=? WHERE id=?",
        (created["memory_id"], now_ts, sid)
    )

    emit("share.approved", row["source_memory_id"], {"suggestion_id": sid, "derived_id": created["memory_id"]})
    return {
        "status": "approved",
        "suggestion_id": sid,
        "derived_memory": created
    }


@router.post("/{sid}/reject")
def reject_suggestion(sid: str):
    row = db.execute(
        "SELECT id, source_memory_id, proposed_text, status FROM share_suggestions WHERE id = ?",
        (sid,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    now_ts = int(time.time() * 1000)
    db.execute(
        "UPDATE share_suggestions SET status='rejected', decided_at=? WHERE id=?",
        (now_ts, sid)
    )

    # Rejection is also an on-device learning signal
    try:
        from edge.store.embed import embed_doc
        vectors = embed_doc(row["proposed_text"])
        db.execute(
            "INSERT INTO gate_feedback(memory_id, text, dense_json, model_category, user_category, ts) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (row["source_memory_id"], row["proposed_text"], json.dumps(vectors["dense"]), "shareable", "private", now_ts),
        )
    except Exception:
        pass

    emit("share.rejected", row["source_memory_id"], {"suggestion_id": sid})
    return {"status": "rejected", "suggestion_id": sid}
