"""Bootstrap the local shared shard from the server snapshot."""
import sys
import shutil
import tempfile
from pathlib import Path
import httpx

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qdrant_edge import EdgeShard
from edge.config import settings

def bootstrap():
    data_dir = settings.dir / "shared"
    print(f"Bootstrapping shared shard for {settings.device_id} at {data_dir}...")

    with tempfile.TemporaryDirectory(dir=settings.dir) as tmp:
        snap = Path(tmp) / "shard.snapshot"
        url = f"{settings.sync_api_url}/snapshot"
        print(f"Downloading server snapshot from {url}...")
        with httpx.stream("GET", url, timeout=120) as r:
            r.raise_for_status()
            with open(snap, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

        if data_dir.exists():
            shutil.rmtree(data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)

        print(f"Unpacking snapshot to {data_dir}...")
        EdgeShard.unpack_snapshot(str(snap), str(data_dir))
        # Sanity check it loads cleanly
        s = EdgeShard.load(str(data_dir))
        s.close()
        print(f"Shared shard bootstrapped successfully for {settings.device_id}!")

if __name__ == "__main__":
    bootstrap()
