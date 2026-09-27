import json
import httpx
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from edge.config import settings
from edge import db
from edge.events import emit
from edge.memory import service

class ResolveRequest(BaseModel):
    resolution: str  # keep_local | keep_remote | merged
    merged_text: Optional[str] = None

router = APIRouter(prefix="/conflicts", tags=["Conflicts"])

@router.get("")
def list_conflicts():
    rows = db.execute("SELECT id, memory_id, kind, local_json, remote_json, status, resolution, created_at FROM conflicts ORDER BY created_at DESC").fetchall()
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
        })
    return results

@router.post("/{conflict_id}/resolve")
async def resolve_conflict(conflict_id: str, req: ResolveRequest):
    row = db.execute("SELECT * FROM conflicts WHERE id=?", (conflict_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conflict not found")

    memory_id = row["memory_id"]
    local_data = json.loads(row["local_json"])
    remote_data = json.loads(row["remote_json"])

    # Call Cloud Sync API to coordinate resolution across fleet
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(
                f"{settings.sync_api_url}/conflicts/resolve",
                json={
                    "conflict_id": conflict_id,
                    "resolution": req.resolution,
                    "merged_text": req.merged_text
                }
            )
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to submit resolution to cloud: {e}")

    # Apply local resolution
    new_text = req.merged_text if req.resolution == "merged" else (
        local_data.get("text") if req.resolution == "keep_local" else remote_data.get("text")
    )

    if new_text:
        service.update(memory_id, text=new_text)

    db.execute(
        "UPDATE conflicts SET status='resolved', resolution=? WHERE id=?",
        (req.resolution, conflict_id)
    )
    emit("conflict.resolved", memory_id, {"conflict_id": conflict_id, "resolution": req.resolution})

    return {"status": "resolved", "conflict_id": conflict_id, "resolution": req.resolution}
