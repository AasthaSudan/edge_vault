from fastapi import APIRouter, HTTPException, Query, Response, status
from typing import Optional
from pydantic import BaseModel
from edge.memory.models import CreateMemoryRequest, UpdateMemoryRequest
from edge.memory import service

class OverrideCategoryRequest(BaseModel):
    category: str

router = APIRouter(prefix="/memories", tags=["Memories"])

@router.post("", status_code=status.HTTP_201_CREATED)
def create_memory(req: CreateMemoryRequest):
    return service.create(
        text=req.text,
        title=req.title or "",
        asset_tag=req.asset_tag or "",
        category=req.category
    )

@router.get("")
def list_memories(
    category: Optional[str] = Query(None),
    asset_tag: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    return service.list_memories(category=category, asset_tag=asset_tag, limit=limit, offset=offset)

@router.get("/{memory_id}")
def get_memory(memory_id: str):
    _, rec = service.get(memory_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Memory not found")
    return rec.payload

@router.patch("/{memory_id}")
def update_memory(memory_id: str, req: UpdateMemoryRequest):
    updated = service.update(
        mid=memory_id,
        text=req.text,
        title=req.title,
        asset_tag=req.asset_tag
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Memory not found")
    return updated

@router.post("/{memory_id}/category")
def override_category(memory_id: str, req: OverrideCategoryRequest):
    updated = service.change_category(memory_id, req.category)
    if not updated:
        raise HTTPException(status_code=404, detail="Memory not found or invalid category")
    return updated

@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(memory_id: str):
    success = service.delete(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
