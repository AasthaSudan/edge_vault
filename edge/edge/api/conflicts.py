import json
import httpx
from typing import Literal, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from edge.config import settings
from edge import db
from edge.events import emit
from edge.gate import pii
from edge.memory import service
from edge.assistant import reconcile

class ResolveRequest(BaseModel):
    resolution: Literal["keep_local", "keep_remote", "merged"]
    merged_text: Optional[str] = None

router = APIRouter(prefix="/conflicts", tags=["Conflicts"])

@router.get("")
def list_conflicts():
    rows = db.execute("SELECT id, memory_id, kind, local_json, remote_json, status, resolution, created_at, analysis_json FROM conflicts ORDER BY created_at DESC").fetchall()
    results = []
    for r in rows:
        results.append({
            "id": r["id"],
            "memory_id": r["memory_id"],
            "kind": r["kind"],
            "local": json.loads(r["local_json"]),
            "remote": json.loads(r["remote_json"]),
            "status": r["status"],
            "resolution": r["resolution"],
            "created_at": r["created_at"],
            "analysis": json.loads(r["analysis_json"]) if r["analysis_json"] else None,
        })
    return results


@router.post("/{conflict_id}/analyze")
def analyze_conflict(conflict_id: str, refresh: bool = False):
    """On-device LLM reconciliation: progression vs contradiction, plus a recommendation.
    Cached per conflict; a fallback result (model unavailable) is not cached."""
    row = db.execute("SELECT local_json, remote_json, analysis_json FROM conflicts WHERE id=?", (conflict_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conflict not found")
    if row["analysis_json"] and not refresh:
        return json.loads(row["analysis_json"])

    result = reconcile.analyze(json.loads(row["local_json"]), json.loads(row["remote_json"]))
    if result["source"] != "fallback":
        db.execute("UPDATE conflicts SET analysis_json=? WHERE id=?", (json.dumps(result), conflict_id))
    emit("conflict.analyzed", None, {"conflict_id": conflict_id, "relation": result["relation"],
                                     "recommendation": result["recommendation"], "source": result["source"]})
    return result

@router.post("/{conflict_id}/resolve")
async def resolve_conflict(conflict_id: str, req: ResolveRequest):
    row = db.execute("SELECT * FROM conflicts WHERE id=?", (conflict_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conflict not found")

    memory_id = row["memory_id"]
    local_data = json.loads(row["local_json"])
    remote_data = json.loads(row["remote_json"])

    if req.resolution == "merged":
        # The merge box is typed by hand and goes to the fleet, so it is checked here, before the cloud
        # call: the cloud stores it as fleet text and would hold anything typed there until retracted.
        if not (req.merged_text or "").strip():
            raise HTTPException(status_code=400, detail="Merged text is empty: write the merged note or keep one version")
        hits = pii.scan(req.merged_text)
        if hits:
            raise HTTPException(status_code=400, detail=f"Merged text contains sensitive patterns ({', '.join(hits)}); it cannot be shared")

    # Call Cloud Sync API to coordinate resolution across fleet
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(
                f"{settings.sync_api_url}/conflicts/resolve",
                headers=settings.cloud_headers(),
                json={
                    "conflict_id": conflict_id,
                    "resolution": req.resolution,
                    "merged_text": req.merged_text
                }
            )
            r.raise_for_status()
            server_version = r.json().get("version")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to submit resolution to cloud: {e}")

    # Apply local resolution
    new_text = req.merged_text if req.resolution == "merged" else (
        local_data.get("text") if req.resolution == "keep_local" else remote_data.get("text")
    )

    if new_text:
        # Base the edit on the version the cloud now holds, so the push is accepted
        # (and re-embeds the winning text on the server) instead of re-conflicting.
        service.update(memory_id, text=new_text, server_version=server_version)

    db.execute(
        "UPDATE conflicts SET status='resolved', resolution=? WHERE id=?",
        (req.resolution, conflict_id)
    )
    emit("conflict.resolved", memory_id, {"conflict_id": conflict_id, "resolution": req.resolution})

    return {"status": "resolved", "conflict_id": conflict_id, "resolution": req.resolution}
