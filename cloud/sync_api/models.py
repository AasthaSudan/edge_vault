from typing import Optional, List, Dict, Any
from pydantic import BaseModel

class PushItem(BaseModel):
    memory_id: str
    op: str  # 'upsert' | 'delete'
    point: Dict[str, Any]
    version: int
    base_version: int

class PushBody(BaseModel):
    device_id: str
    items: List[PushItem]

class ResolveConflictRequest(BaseModel):
    conflict_id: str
    resolution: str  # 'keep_local' | 'keep_remote' | 'merged'
    merged_text: Optional[str] = None
