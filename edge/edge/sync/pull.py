import time
import httpx
from qdrant_edge import Point, PointVectors, SparseVector, UpdateOperation
from edge.config import settings
from edge.store.shards import shared
from edge.sync import outbox
from edge.events import emit
from edge import db

PULL_OVERLAP_MS = 5000

async def pull_once(client: httpx.AsyncClient) -> bool:
    # Golden Sync Rule: Never pull if local edits are pending in the outbox
    if outbox.depth() > 0:
        emit("sync.pull.skipped", data={"reason": "outbox not empty"})
        return False

    try:
        # Cursor on the SERVER clock (server_ts), never this device's clock
        cursor_row = db.fetch_all("SELECT value FROM settings WHERE key = 'pull_cursor'")
        since_ts = int(cursor_row[0]["value"]) if cursor_row else 0

        # Paged delta pull: fetch every new/updated shareable record, not just the first page
        offset, server_now, pulled = None, None, 0
        while True:
            params = {"since_ts": since_ts, "limit": 100}
            if offset:
                params["offset"] = offset
            r = await client.get(f"{settings.sync_api_url}/pull/records", params=params, timeout=10)
            if r.status_code != 200:
                return False
            data = r.json()
            if server_now is None:
                server_now = data.get("server_now")
            records = data.get("records", [])
            _apply(records)
            pulled += len(records)
            offset = data.get("next_offset")
            if not offset:
                break

        # Overlap by PULL_OVERLAP_MS so a push that was mid-write during this pull is
        # fetched next time; re-applying a record is idempotent.
        if server_now:
            db.execute(
                "INSERT OR REPLACE INTO settings(key, value) VALUES ('pull_cursor', ?)",
                (str(max(0, server_now - PULL_OVERLAP_MS)),)
            )
        now_ts = int(time.time() * 1000)
        db.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('last_pull_at', ?)",
            (str(now_ts),)
        )
        emit("sync.pull.ok", data={"records": pulled})
        return True
    except Exception as e:
        print(f"Sync pull note: {e}")
        return False


def _local_versions(ids: list) -> dict:
    with shared.lock:
        try:
            return {str(r.id): r.payload.get("version", 0) for r in shared.shard.retrieve(ids, True, False)}
        except Exception:
            return {}


def _apply(records: list[dict]) -> None:
    points = []
    local = _local_versions([r["id"] for r in records])
    for item in records:
        pl = item.get("payload", {})
        # Defense-in-depth: Never write non-shareable to shared shard
        if pl.get("category") != "shareable":
            continue

        # Our own note: skip only if we still hold it at the same or a newer version.
        # If the local copy is missing (e.g. lost in a crash), restore it from the fleet.
        if pl.get("device_id") == settings.device_id and local.get(str(item["id"]), -1) >= pl.get("version", 0):
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

        points.append(Point(id=item["id"], vector=vec_dict, payload=pl))

    if points:
        # One update per page = one flush to disk, not one per record
        with shared.lock:
            shared.shard.update(UpdateOperation.upsert_points(points))
