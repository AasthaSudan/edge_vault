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
        self.shard = None
        self._ensure_open()

    def _open(self) -> EdgeShard:
        if self.path.exists() and any(self.path.iterdir()):
            try:
                return EdgeShard.load(str(self.path))
            except Exception as e:
                # If existing shard files are corrupted or half-written by snapshot
                print(f"Warning loading shard at {self.path}: {e}. Reinitializing clean shard.")
                import shutil
                shutil.rmtree(self.path, ignore_errors=True)

        self.path.mkdir(parents=True, exist_ok=True)
        s = EdgeShard.create(str(self.path), CONFIG)
        for field, schema in INDEXES.items():
            s.update(UpdateOperation.create_field_index(field, schema))
        return s

    def _ensure_open(self):
        if self.shard is None:
            self.shard = self._open()

    def reopen(self):
        with self.lock:
            if self.shard is not None and hasattr(self.shard, "close"):
                try:
                    self.shard.close()
                except Exception:
                    pass
            self.shard = self._open()

    def close(self):
        with self.lock:
            if self.shard is not None and hasattr(self.shard, "close"):
                try:
                    self.shard.close()
                except Exception:
                    pass
                self.shard = None

# Shard instances
private = Shard(settings.dir / "private")
shared = Shard(settings.dir / "shared")

def shard_for(category: str) -> Shard:
    return shared if category == "shareable" else private
