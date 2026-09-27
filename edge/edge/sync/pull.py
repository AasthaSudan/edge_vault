import time
import tempfile
from pathlib import Path
import httpx
from edge.config import settings
from edge.store.shards import shared
from edge.sync import outbox
from edge.events import emit
from edge import db

async def pull_once(client: httpx.AsyncClient) -> bool:
    # Golden Sync Rule: Never pull if local edits are pending in the outbox
    if outbox.depth() > 0:
        emit("sync.pull.skipped", data={"reason": "outbox not empty"})
        return False

    try:
        with shared.lock:
            manifest = shared.shard.snapshot_manifest()

        with tempfile.TemporaryDirectory(dir=settings.dir) as tmp:
            path = Path(tmp) / "partial.snapshot"
            async with client.stream(
                "POST",
                f"{settings.sync_api_url}/snapshot/partial",
                json=manifest if isinstance(manifest, (dict, list)) else {},
                timeout=60
            ) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes():
                        f.write(chunk)

            # Apply delta snapshot to the shared shard
            with shared.lock:
                shared.shard.update_from_snapshot(str(path))

        now_ts = int(time.time() * 1000)
        db.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('last_pull_at', ?)",
            (str(now_ts),)
        )
        emit("sync.pull.ok")
        return True
    except Exception as e:
        print(f"Sync pull warning: {e}")
        return False
