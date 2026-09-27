import time
import uuid
import json
from typing import Optional, Tuple
from qdrant_edge import Point, UpdateOperation, ScrollRequest, Filter, FieldCondition, MatchValue
from edge.config import settings
from edge.store.embed import embed_doc
from edge.store.shards import shard_for, private, shared, Shard
from edge.gate.gate import decide
from edge.memory.dedup import find_duplicate
from edge.events import emit
from edge import db

def now_ms() -> int:
    return int(time.time() * 1000)

def create(
    text: str,
    title: str = "",
    asset_tag: str = "",
    category: Optional[str] = None
) -> dict:
    mid = str(uuid.uuid4())
    ts = now_ms()
    vectors = embed_doc(text)

    # 1. Gate Classification
    if category and category in ("shareable", "private", "routine"):
        cat = category
        source = "user"
        reason = "Set manually by technician"
        pii_hits = []
    else:
        decision = decide(text)
        cat = decision.category
        source = decision.source
        reason = decision.reason
        pii_hits = decision.pii_hits

    target_shard = shard_for(cat)

    # 2. Check for Near-Duplicate on target shard
    dup = find_duplicate(target_shard, vectors["dense"], asset_tag=asset_tag)
    if dup:
        cur = dict(dup.payload)
        old_version = cur.get("version", 1)
        cur["text"] = text
        cur["version"] = old_version + 1
        cur["base_version"] = old_version
        cur["updated_at"] = ts
        if "merged_from" not in cur or not isinstance(cur["merged_from"], list):
            cur["merged_from"] = []
        cur["merged_from"].append(mid)

        # Update point in target shard
        with target_shard.lock:
            target_shard.shard.update(UpdateOperation.upsert_points([
                Point(id=dup.id, vector=vectors, payload=cur)
            ]))

        # Enqueue in outbox if shareable
        if cat == "shareable":
            point_data = {"id": str(dup.id), "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}}, "payload": cur}
            db.execute(
                "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (str(dup.id), "upsert", json.dumps(point_data), cur["version"], cur["base_version"], ts)
            )

        emit("dedup.merged", str(dup.id), {"version": cur["version"], "original_id": str(dup.id)})
        return cur

    # 3. Handle Routine TTL Expiration
    expires_at = None
    if cat == "routine":
        expires_at = ts + (settings.routine_ttl_days * 86400 * 1000)

    # 4. Construct Payload
    payload = {
        "memory_id": mid,
        "text": text,
        "title": title,
        "asset_tag": asset_tag,
        "category": cat,
        "gate_source": source,
        "gate_reason": reason,
        "pii_hits": pii_hits,
        "device_id": settings.device_id,
        "author": settings.author,
        "version": 1,
        "base_version": 0,
        "created_at": ts,
        "updated_at": ts,
        "expires_at": expires_at,
        "deleted": False,
        "merged_from": [],
        "sync_state": "pending" if cat == "shareable" else "local_only",
    }

    # 5. Insert point
    point = Point(id=mid, vector=vectors, payload=payload)
    with target_shard.lock:
        target_shard.shard.update(UpdateOperation.upsert_points([point]))

    # 6. Enqueue in Outbox if Shareable
    if cat == "shareable":
        point_data = {"id": mid, "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}}, "payload": payload}
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "upsert", json.dumps(point_data), 1, 0, ts)
        )

    emit("gate.decided", mid, {"category": cat, "source": source, "reason": reason, "pii_hits": pii_hits})
    emit("memory.created", mid, {"category": cat})
    return payload

def get(mid: str) -> Tuple[Optional[Shard], Optional[object]]:
    for sh in (private, shared):
        with sh.lock:
            try:
                recs = sh.shard.retrieve([mid], True, True)
                if recs:
                    return sh, recs[0]
            except Exception:
                continue
    return None, None

def list_memories(category: Optional[str] = None, asset_tag: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[dict]:
    results = []
    shards_to_check = [shard_for(category)] if category else [private, shared]

    flt_conditions = [FieldCondition(key="deleted", match=MatchValue(value=False))]
    if category:
        flt_conditions.append(FieldCondition(key="category", match=MatchValue(value=category)))
    if asset_tag:
        flt_conditions.append(FieldCondition(key="asset_tag", match=MatchValue(value=asset_tag)))

    flt = Filter(must=flt_conditions)

    for sh in shards_to_check:
        with sh.lock:
            recs, _ = sh.shard.scroll(ScrollRequest(
                limit=limit + offset,
                filter=flt,
                with_payload=True,
                with_vector=False
            ))
            for r in recs:
                if not r.payload.get("deleted", False):
                    results.append(r.payload)

    results.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    return results[offset:offset + limit]

def update(mid: str, text: Optional[str] = None, title: Optional[str] = None, asset_tag: Optional[str] = None) -> Optional[dict]:
    sh, rec = get(mid)
    if not rec or not sh:
        return None

    cur = dict(rec.payload)
    cur["version"] = cur.get("version", 1) + 1
    cur["base_version"] = cur.get("version", 1)
    cur["updated_at"] = now_ms()

    if title is not None:
        cur["title"] = title
    if asset_tag is not None:
        cur["asset_tag"] = asset_tag

    new_text = text if text is not None else cur["text"]
    cur["text"] = new_text

    vectors = embed_doc(new_text)
    point = Point(id=mid, vector=vectors, payload=cur)

    with sh.lock:
        sh.shard.update(UpdateOperation.upsert_points([point]))

    if cur.get("category") == "shareable":
        point_data = {"id": mid, "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}}, "payload": cur}
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "upsert", json.dumps(point_data), cur["version"], cur["base_version"], cur["updated_at"])
        )

    emit("memory.updated", mid, {"category": cur.get("category")})
    return cur

def delete(mid: str) -> bool:
    sh, rec = get(mid)
    if not rec or not sh:
        return False

    cur = dict(rec.payload)
    ts = now_ms()
    if cur.get("category") == "shareable":
        cur["deleted"] = True
        cur["updated_at"] = ts
        cur["version"] = cur.get("version", 1) + 1
        vectors = embed_doc(cur["text"])
        point = Point(id=mid, vector=vectors, payload=cur)
        with sh.lock:
            sh.shard.update(UpdateOperation.upsert_points([point]))

        # Enqueue delete tombstone in outbox
        point_data = {"id": mid, "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}}, "payload": cur}
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "delete", json.dumps(point_data), cur["version"], cur["base_version"], ts)
        )
    else:
        with sh.lock:
            sh.shard.update(UpdateOperation.delete_points([mid]))

    emit("memory.deleted", mid, {"category": cur.get("category")})
    return True

def change_category(mid: str, new_category: str) -> Optional[dict]:
    """User override to move memory between shards and update fleet synchronization."""
    if new_category not in ("shareable", "private", "routine"):
        return None

    old_sh, rec = get(mid)
    if not rec or not old_sh:
        return None

    cur = dict(rec.payload)
    old_cat = cur.get("category")
    if old_cat == new_category:
        return cur

    ts = now_ms()
    cur["category"] = new_category
    cur["gate_source"] = "user"
    cur["gate_reason"] = f"Manual override by technician from {old_cat} to {new_category}"
    cur["updated_at"] = ts
    cur["version"] = cur.get("version", 1) + 1
    cur["base_version"] = cur.get("version", 1)

    new_sh = shard_for(new_category)
    vectors = embed_doc(cur["text"])
    point = Point(id=mid, vector=vectors, payload=cur)

    # Remove from old shard
    with old_sh.lock:
        old_sh.shard.update(UpdateOperation.delete_points([mid]))

    # Insert into new shard
    with new_sh.lock:
        new_sh.shard.update(UpdateOperation.upsert_points([point]))

    # Outbox orchestration
    if new_category == "shareable":
        point_data = {"id": mid, "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}}, "payload": cur}
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "upsert", json.dumps(point_data), cur["version"], cur["base_version"], ts)
        )
    elif old_cat == "shareable":
        # Retraction from fleet: enqueue delete tombstone with category shareable so server marks it deleted
        retract_payload = dict(cur)
        retract_payload["category"] = "shareable"
        retract_payload["deleted"] = True
        point_data = {
            "id": mid,
            "vector": {"dense": vectors["dense"], "bm25": {"indices": list(vectors["bm25"].indices), "values": list(vectors["bm25"].values)}},
            "payload": retract_payload
        }
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "delete", json.dumps(point_data), cur["version"], cur["base_version"], ts)
        )

    emit("gate.overridden", mid, {"old_category": old_cat, "new_category": new_category})
    return cur
