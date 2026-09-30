from typing import Literal, Optional, List
from pydantic import BaseModel, Field

class Memory(BaseModel):
    memory_id: str
    text: str
    title: str = ""
    asset_tag: str = ""
    category: str = "private"  # shareable | private | routine
    gate_source: str = "user"  # rule | llm | user | fallback
    gate_reason: str = "set manually"
    pii_hits: List[str] = Field(default_factory=list)
    device_id: str
    author: str
    version: int = 1
    base_version: int = 0
    created_at: int
    updated_at: int
    expires_at: Optional[int] = None
    deleted: bool = False
    merged_from: List[str] = Field(default_factory=list)
    sync_state: str = "local_only"  # local_only | pending | synced

class CreateMemoryRequest(BaseModel):
    text: str
    title: Optional[str] = ""
    asset_tag: Optional[str] = ""
    category: Optional[str] = None

class UpdateMemoryRequest(BaseModel):
    text: Optional[str] = None
    title: Optional[str] = None
    asset_tag: Optional[str] = None

class SearchRequest(BaseModel):
    q: str
    mode: Optional[Literal["hybrid", "dense", "bm25"]] = "hybrid"
    category: Optional[str] = None
    asset_tag: Optional[str] = None
    device_id: Optional[str] = None
    limit: Optional[int] = Field(10, ge=1, le=100)
