import threading
import shutil
import time
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

class DurableEdgeShard:
    """EdgeShard whose every update is flushed to disk before returning.

    Qdrant Edge keeps updates in memory until flush()/close(); a crash, power loss or
    killed process loses them all (reproduced: 5 upserts + hard kill -> 0 points on
    reload). A field device must never lose an acknowledged note, so each update is
    followed by flush() (~40 ms). Batch many points into one update where possible."""

    def __init__(self, inner: EdgeShard):
        self._inner = inner

    def update(self, op):
        result = self._inner.update(op)
        self._inner.flush()
        return result

    def __getattr__(self, name):
        return getattr(self._inner, name)


class Shard:
    """Thin thread-safe wrapper: one lock per shard, because Edge operations are synchronous."""
    def __init__(self, path: Path):
        self.path = path
        # Re-entrant: reopen() holds the lock while _init_or_recover() takes it again
        self.lock = threading.RLock()
        self.shard = None
        self._init_or_recover()

    def _init_or_recover(self):
        with self.lock:
            try:
                if self.path.exists() and any(self.path.iterdir()):
                    self.shard = DurableEdgeShard(EdgeShard.load(str(self.path)))
                    return
            except Exception as e:
                err_msg = str(e)
                if "WouldBlock" in err_msg or "Resource temporarily unavailable" in err_msg or "already borrowed" in err_msg:
                    raise
                # Never delete a device's memory: move the unreadable shard aside for recovery
                backup = self.path.with_name(f"{self.path.name}.unreadable-{int(time.time())}")
                print(f"Notice: shard at {self.path} could not be loaded ({e}); moved to {backup}")
                shutil.move(str(self.path), str(backup))

            self.path.mkdir(parents=True, exist_ok=True)
            self.shard = DurableEdgeShard(EdgeShard.create(str(self.path), CONFIG))
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
