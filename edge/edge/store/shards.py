import threading
from pathlib import Path
from qdrant_edge import (
    EdgeShard, EdgeConfig, EdgeVectorParams,
    EdgeSparseVectorParams, Distance, Modifier,
    UpdateOperation, PayloadSchemaType
)
from edge.config import settings

CONFIG = EdgeConfig(
    vectors={"dense": EdgeVectorParams(size=settings.dense_dim, distance=Distance.Cosine)},
    sparse_vectors={"bm25": EdgeSparseVectorParams(modifier=Modifier.Idf)},
)

INDEXES = {
    "category": PayloadSchemaType.Keyword,
    "asset_tag": PayloadSchemaType.Keyword,
    "device_id": PayloadSchemaType.Keyword,
    "sync_state": PayloadSchemaType.Keyword,
    "updated_at": PayloadSchemaType.Integer,
    "deleted": PayloadSchemaType.Bool,
}

class Shard:
    """Thin thread-safe wrapper: one lock per shard, because Edge operations are synchronous."""
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.shard = self._open()

    def _open(self) -> EdgeShard:
        if self.path.exists() and any(self.path.iterdir()):
            return EdgeShard.load(str(self.path))
        self.path.mkdir(parents=True, exist_ok=True)
        s = EdgeShard.create(str(self.path), CONFIG)
        for field, schema in INDEXES.items():
            s.update(UpdateOperation.create_field_index(field, schema))
        return s

    def reopen(self):
        with self.lock:
            self.shard.close()
            self.shard = EdgeShard.load(str(self.path))

    def close(self):
        with self.lock:
            if hasattr(self.shard, "close"):
                self.shard.close()

# Shard instances
private = Shard(settings.dir / "private")
shared = Shard(settings.dir / "shared")

def shard_for(category: str) -> Shard:
    return shared if category == "shareable" else private
