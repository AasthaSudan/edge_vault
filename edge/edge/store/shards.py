import threading
import shutil
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
    "gate_source": PayloadSchemaType.Keyword,
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
        self._init_or_recover()

    def _init_or_recover(self):
        with self.lock:
            try:
                if self.path.exists() and any(self.path.iterdir()):
                    self.shard = EdgeShard.load(str(self.path))
                    return
            except Exception as e:
                err_msg = str(e)
                if "WouldBlock" in err_msg or "Resource temporarily unavailable" in err_msg or "already borrowed" in err_msg:
                    raise
                print(f"Notice: Cleaning uninitialized or corrupted shard at {self.path} ({e})")
                shutil.rmtree(self.path, ignore_errors=True)

            self.path.mkdir(parents=True, exist_ok=True)
            self.shard = EdgeShard.create(str(self.path), CONFIG)
            for field, schema in INDEXES.items():
                self.shard.update(UpdateOperation.create_field_index(field, schema))

    def reopen(self):
        with self.lock:
            if self.shard is not None and hasattr(self.shard, "close"):
                try:
                    self.shard.close()
                except Exception:
                    pass
            self._init_or_recover()

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
