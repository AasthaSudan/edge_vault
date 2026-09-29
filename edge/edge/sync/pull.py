import time
import httpx
from qdrant_edge import Point, PointVectors, SparseVector, UpdateOperation
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
        # Check last pull timestamp from SQLite
        last_pull_row = db.fetch_all("SELECT value FROM settings WHERE key = 'last_pull_at'")
        since_ts = int(last_pull_row[0]["value"]) if last_pull_row else 0

        # Fast delta pull: only fetch new/updated shareable records
        r = await client.get(
            f"{settings.sync_api_url}/pull/records",
            params={"since_ts": since_ts, "limit": 100},
            timeout=10
        )
        if r.status_code != 200:
            return False

        data = r.json()
        records = data.get("records", [])

        if records:
            with shared.lock:
                for item in records:
                    pl = item.get("payload", {})
                    # Defense-in-depth: Never write non-shareable to shared shard
                    if pl.get("category") != "shareable":
                        continue

                    # Don't overwrite if it's from this same device and we already have it
                    if pl.get("device_id") == settings.device_id:
                        continue

                    v = item.get("vector") or {}
                    dense_vec = v.get("dense")
                    sparse_dict = v.get("bm25") or {}
                    bm25_indices = sparse_dict.get("indices", [])
                    bm25_values = sparse_dict.get("values", [])

                    vec_dict = {}
                    if dense_vec:
                        vec_dict["dense"] = dense_vec
                    if bm25_indices and bm25_values:
                        vec_dict["bm25"] = SparseVector(indices=bm25_indices, values=bm25_values)

                    point = Point(id=item["id"], vector=vec_dict, payload=pl)
                    shared.shard.update(UpdateOperation.upsert_points([point]))

        now_ts = int(time.time() * 1000)
        db.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('last_pull_at', ?)",
            (str(now_ts),)
        )
        emit("sync.pull.ok")
        return True
    except Exception as e:
        print(f"Sync pull note: {e}")
        return False
