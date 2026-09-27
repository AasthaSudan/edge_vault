from fastapi import APIRouter
from edge.memory.models import SearchRequest
from edge.store import search as store_search

router = APIRouter(prefix="/search", tags=["Search"])

@router.post("")
def run_search(req: SearchRequest):
    return store_search.search(
        q=req.q,
        mode=req.mode or "hybrid",
        limit=req.limit or 10,
        category=req.category,
        asset_tag=req.asset_tag,
        device_id=req.device_id
    )
