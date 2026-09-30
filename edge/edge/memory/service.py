import time
import uuid
import json
from typing import Optional, Tuple
from qdrant_edge import Point, UpdateOperation, ScrollRequest, Filter, FieldCondition, MatchValue
from edge.config import settings
from edge.store.embed import embed_doc
from edge.store.shards import shard_for, private, shared, Shard
from edge.gate import gate as gatemod, pii
from edge.gate import worker as gate_worker
from edge.memory.dedup import find_duplicate
from edge.privacy import egress
from edge.events import emit
from edge import db


def now_ms() -> int:
    return int(time.time() * 1000)


_SCROLL_PAGE = 500     # points per scroll call when listing
_LIST_CAP = 20000      # safety bound on how many notes list_memories will load


def _base_payload(mid: str, text: str, title: str, asset_tag: str, d: gatemod.GateDecision, ts: int) -> dict:
    return {
        "memory_id": mid,
        "text": text,
        "title": title,
        "asset_tag": asset_tag,
        "category": d.category,
        "gate_source": d.source,
        "gate_reason": d.reason,
        "gate_signals": getattr(d, "signals", []),
        "gate_flags": getattr(d, "flags", []),
        "gate_context": getattr(d, "context_used", {}),
        "pii_hits": d.pii_hits,
        "device_id": settings.device_id,
        "author": settings.author,
        "version": 1,
        "base_version": 0,
        "created_at": ts,
        "updated_at": ts,
        "expires_at": None,
        "deleted": False,
        "merged_from": [],
        "sync_state": "pending" if d.category == "shareable" else "local_only",
    }


def _corroborate(cur: dict) -> None:
    """This device's note merged into a fleet note from ANOTHER device: an independent
    report of the same fact. Record it; the cloud keeps the union across all pushes."""
    if cur.get("category") != "shareable" or cur.get("device_id") == settings.device_id:
        return
    devs = set(cur.get("corroborated_by") or []) | {cur.get("device_id"), settings.device_id}
    devs.discard(None)
    cur.update(corroborated_by=sorted(devs), corroboration_count=len(devs), fleet_verified=len(devs) >= 2)


def _upsert(sh: Shard, mid: str, vectors: dict, payload: dict):
    with sh.lock:
        sh.shard.update(UpdateOperation.upsert_points([Point(id=mid, vector=vectors, payload=payload)]))


def _delete(sh: Shard, mid: str):
    with sh.lock:
        sh.shard.update(UpdateOperation.delete_points([mid]))


def _enqueue_job(mid: str, kind: str):
    try:
        db.execute(
            "INSERT INTO gate_jobs(memory_id, kind, created_at) VALUES (?, ?, ?)",
            (mid, kind, now_ms())
        )
        gate_worker.notify()
    except Exception as e:
        print(f"Error enqueueing job {kind} for {mid}: {e}")


def create(
    text: str,
    title: str = "",
    asset_tag: str = "",
    category: Optional[str] = None,
    reason: Optional[str] = None,
    dedup: bool = True
) -> dict:
    """dedup=False for derived content (e.g. a saved assistant answer): it must never be
    merged into, and overwrite, the note it was derived from."""
    mid = str(uuid.uuid4())
    ts = now_ms()
    vectors = embed_doc(text)

    # A PII rule hit outranks a requested "shareable" (privacy rule 2): fall through to the rule path.
    if category == "shareable" and pii.scan(f"{title} {text}"):
        category = None

    # 1. Manual user override specified at creation
    if category and category in ("shareable", "private", "routine"):
        d = gatemod.GateDecision(
            category=category,
            source="user",
            reason=reason or "Set manually by technician",
            pii_hits=[],
            signals=["equipment_fix"] if category == "shareable" else []
        )
        target_shard = shard_for(category)

        # Check for near duplicate
        dup = find_duplicate(target_shard, vectors["dense"], asset_tag=asset_tag) if dedup else None
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
            _corroborate(cur)

            _upsert(target_shard, str(dup.id), vectors, cur)
            if category == "shareable":
                egress.enqueue_shareable(str(dup.id), vectors, cur, cur["version"], cur["base_version"])
            emit("dedup.merged", str(dup.id), {"version": cur["version"], "original_id": str(dup.id)})
            return cur

        payload = _base_payload(mid, text, title, asset_tag, d, ts)
        if category == "routine":
            payload["expires_at"] = ts + (settings.routine_ttl_days * 86400 * 1000)

        _upsert(target_shard, mid, vectors, payload)
        if category == "shareable":
            egress.enqueue_shareable(mid, vectors, payload, 1, 0)

        emit("gate.decided", mid, {"category": category, "source": "user", "reason": d.reason})
        emit("memory.created", mid, {"category": category})
        return payload

    # 2. Rule Check (instant, unconditional, private)
    ruled = gatemod.rule_check(f"{title} {text}")
    if ruled:
        payload = _base_payload(mid, text, title, asset_tag, ruled, ts)
        _upsert(private, mid, vectors, payload)
        emit("gate.decided", mid, {"category": "private", "source": "rule", "reason": ruled.reason})
        emit("memory.created", mid, {"category": "private"})
        if ruled.sanitize_candidate:
            _enqueue_job(mid, "sanitize")
        return payload

    # 3. Mode Sync (Evaluation mode or fallback)
    if settings.gate_mode == "sync":
        return finalize(mid, text, title, asset_tag, ts, vectors, provisional=False, dedup=dedup)

    # 4. Mode Async (Fail-closed by construction): write provisional private immediately
    pending_decision = gatemod.GateDecision(
        category="private",
        source="pending",
        reason="Classifying on device…",
        signals=[]
    )
    payload = _base_payload(mid, text, title, asset_tag, pending_decision, ts)
    if not dedup:
        payload["derived"] = True  # tells finalize() not to merge it into an existing note
    _upsert(private, mid, vectors, payload)
    emit("memory.created", mid, {"category": "private", "pending": True})
    _enqueue_job(mid, "classify")
    return payload


def create_approved(text: str, title: str = "", asset_tag: str = "") -> dict:
    """Split & Share (spec §955): a NEW shareable memory holding a sanitized fact the
    technician approved. No dedup merge, and no reference to the private original:
    that link lives only in the local share_suggestions table."""
    mid = str(uuid.uuid4())
    ts = now_ms()
    vectors = embed_doc(text)
    d = gatemod.GateDecision(
        category="shareable",
        source="user_approved",
        reason="Sanitized from a private note, approved by technician",
        signals=["equipment_fix"],
    )
    payload = _base_payload(mid, text, title, asset_tag, d, ts)
    _upsert(shared, mid, vectors, payload)
    egress.enqueue_shareable(mid, vectors, payload, 1, 0)
    emit("gate.decided", mid, {"category": "shareable", "source": "user_approved", "reason": d.reason})
    emit("memory.created", mid, {"category": "shareable"})
    return payload


def finalize(
    mid: str,
    text: str,
    title: str = "",
    asset_tag: str = "",
    created_at: int = None,
    vectors: dict = None,
    provisional: bool = True,
    dedup: bool = True
) -> dict:
    """Run Gate v2 and finalize memory category. Called by worker thread or sync mode."""
    created_at = created_at or now_ms()
    vectors = vectors or embed_doc(text)
    d = gatemod.decide_v2(f"{title}\n{text}".strip(), vectors["dense"], memory_id=mid)
    ts = now_ms()

    if provisional:
        # decide_v2 takes seconds (local LLM). Meanwhile the technician may have deleted the note,
        # overridden its category or edited its text. Those actions win: writing this verdict now
        # would resurrect a deleted note (possibly fleet-wide) or clobber the override/edit.
        _, live = get(mid)
        if live is None or live.payload.get("deleted") or live.payload.get("gate_source") != "pending":
            return dict(live.payload) if live else {}
        lp = live.payload
        if (lp.get("text"), lp.get("title", ""), lp.get("asset_tag", "")) != (text, title, asset_tag):
            _enqueue_job(mid, "classify")  # classify the edited text instead
            return dict(lp)

    if d.category == "shareable":
        dup = find_duplicate(shared, vectors["dense"], asset_tag=asset_tag) if dedup else None
        if dup:
            cur = dict(dup.payload)
            base = cur.get("version", 1)
            cur.update(
                text=text,
                version=base + 1,
                base_version=base,
                updated_at=ts,
                sync_state="pending"
            )
            if "merged_from" not in cur or not isinstance(cur["merged_from"], list):
                cur["merged_from"] = []
            cur["merged_from"].append(mid)
            _corroborate(cur)

            _upsert(shared, str(dup.id), vectors, cur)
            egress.enqueue_shareable(str(dup.id), vectors, cur, cur["version"], base)
            if provisional:
                _delete(private, mid)
            emit("dedup.merged", str(dup.id), {"version": cur["version"]})
            return cur

    payload = _base_payload(mid, text, title, asset_tag, d, created_at)
    payload["updated_at"] = ts

    if d.category == "routine":
        payload["expires_at"] = ts + (settings.routine_ttl_days * 86400 * 1000)

    if d.category == "shareable":
        payload["sync_state"] = "pending"
        _upsert(shared, mid, vectors, payload)
        if provisional:
            _delete(private, mid)
        egress.enqueue_shareable(mid, vectors, payload, 1, 0)
    else:
        _upsert(private, mid, vectors, payload)

    emit("gate.decided", mid, {
        "category": d.category,
        "source": d.source,
        "reason": d.reason,
        "signals": d.signals,
        "flags": d.flags,
        "context": d.context_used
    })

    if d.sanitize_candidate:
        _enqueue_job(mid, "sanitize")

    return payload


def reclassify(mid: str) -> Optional[dict]:
    """Re-queue a note the gate could not classify (LLM was down) for Gate v2.
    Only fallback/pending notes qualify: rule hits and user decisions are final."""
    sh, rec = get(mid)
    if not rec or sh is not private:
        return None
    cur = dict(rec.payload)
    if cur.get("gate_source") not in ("fallback", "pending"):
        return None
    cur.update(gate_source="pending", gate_reason="Classifying on device…")
    with sh.lock:
        sh.shard.update(UpdateOperation.set_payload([mid], {"gate_source": "pending", "gate_reason": cur["gate_reason"]}))
    _enqueue_job(mid, "classify")
    return cur


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


def list_memories(
    category: Optional[str] = None,
    asset_tag: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> list[dict]:
    results = []
    shards_to_check = [shard_for(category)] if category else [private, shared]

    flt_conditions = []
    if category:
        flt_conditions.append(FieldCondition(key="category", match=MatchValue(value=category)))
    if asset_tag:
        flt_conditions.append(FieldCondition(key="asset_tag", match=MatchValue(value=asset_tag)))

    flt = Filter(must=flt_conditions) if flt_conditions else None

    # Scroll returns points in id order (random UUIDs), so "newest N" needs every live note:
    # page through the shard (payloads only, lock held per page), then sort and slice.
    for sh in shards_to_check:
        next_offset = None
        while len(results) < _LIST_CAP:
            with sh.lock:
                recs, next_offset = sh.shard.scroll(ScrollRequest(
                    offset=next_offset,
                    limit=_SCROLL_PAGE,
                    filter=flt,
                    with_payload=True,
                    with_vector=False
                ))
            results.extend(r.payload for r in recs if not r.payload.get("deleted", False))
            if next_offset is None or not recs:
                break

    results.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    return results[offset:offset + limit]


def update(
    mid: str,
    text: Optional[str] = None,
    title: Optional[str] = None,
    asset_tag: Optional[str] = None,
    server_version: Optional[int] = None
) -> Optional[dict]:
    """Edit a memory. `server_version` is passed after a conflict resolution, so the
    edit is based on the version the cloud now holds instead of the stale local one."""
    sh, rec = get(mid)
    if not rec or not sh:
        return None

    cur = dict(rec.payload)
    base = server_version if server_version is not None else cur.get("version", 1)
    cur["base_version"] = base
    cur["version"] = base + 1
    cur["updated_at"] = now_ms()

    if title is not None:
        cur["title"] = title
    if asset_tag is not None:
        cur["asset_tag"] = asset_tag

    new_text = cur.get("text", "")
    if text is not None:
        new_text = text
    cur["text"] = new_text

    vectors = embed_doc(new_text)

    # An edit that introduces PII into a shared note moves it back to private and
    # retracts it from the fleet, instead of leaving it in the shared shard.
    hits = pii.scan(f"{cur.get('title', '')} {new_text}") if cur.get("category") == "shareable" else []
    if hits:
        reason = f"Matched rule: {', '.join(hits)}"
        cur.update(category="private", gate_source="rule", gate_reason=reason,
                   pii_hits=hits, sync_state="local_only")
        _delete(sh, mid)
        _upsert(private, mid, vectors, cur)
        egress.enqueue_shareable(mid, vectors, dict(cur, category="shareable"),
                                 cur["version"], cur["base_version"], op="delete")
        emit("gate.decided", mid, {"category": "private", "source": "rule", "reason": reason})
        emit("memory.updated", mid, {"category": "private"})
        return cur

    _upsert(sh, mid, vectors, cur)

    if cur.get("category") == "shareable":
        egress.enqueue_shareable(mid, vectors, cur, cur["version"], cur["base_version"])

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
        cur["base_version"] = cur.get("version", 1)
        cur["version"] = cur["base_version"] + 1
        vectors = embed_doc(cur.get("text", ""))
        _upsert(sh, mid, vectors, cur)
        egress.enqueue_shareable(mid, vectors, cur, cur["version"], cur["base_version"], op="delete")
    else:
        _delete(sh, mid)

    emit("memory.deleted", mid, {"category": cur.get("category")})
    return True


def change_category(mid: str, new_category: str) -> Optional[dict]:
    """User override to move memory between shards, update outbox, and store correction feedback."""
    if new_category not in ("shareable", "private", "routine"):
        return None

    old_sh, rec = get(mid)
    if not rec or not old_sh:
        return None

    cur = dict(rec.payload)
    old_cat = cur.get("category")
    old_source = cur.get("gate_source")
    if old_cat == new_category:
        if old_source == "pending" and new_category == "private":
            # "Keep private" on a note still being classified must stick, otherwise the gate
            # would later promote it to the shared shard and push it to the fleet.
            reason = "Manual override by technician: kept private"
            cur.update(gate_source="user", gate_reason=reason)
            with old_sh.lock:
                old_sh.shard.update(UpdateOperation.set_payload([mid], {"gate_source": "user", "gate_reason": reason}))
            try:
                db.execute("UPDATE gate_jobs SET status='cancelled' WHERE memory_id=? AND status IN ('pending', 'inflight')", (mid,))
            except Exception as e:
                print(f"Gate job cancel notice: {e}")
        return cur
    if new_category == "shareable":
        hits = pii.scan(f"{cur.get('title', '')} {cur.get('text', '')}")
        if hits:
            raise PermissionError(f"Note contains sensitive patterns ({', '.join(hits)}); it cannot be shared.")

    ts = now_ms()
    cur["category"] = new_category
    cur["gate_source"] = "user"
    cur["gate_reason"] = f"Manual override by technician from {old_cat} to {new_category}"
    cur["sync_state"] = "pending" if new_category == "shareable" else "local_only"
    cur["updated_at"] = ts
    cur["base_version"] = cur.get("version", 1)
    cur["version"] = cur["base_version"] + 1
    # Routine notes expire after the TTL; a stale expiry must not follow the note into another category
    cur["expires_at"] = ts + (settings.routine_ttl_days * 86400 * 1000) if new_category == "routine" else None

    new_sh = shard_for(new_category)
    vectors = embed_doc(cur["text"])

    # Remove from old shard
    _delete(old_sh, mid)
    # Insert into new shard
    _upsert(new_sh, mid, vectors, cur)

    # Outbox orchestration via egress
    if new_category == "shareable":
        egress.enqueue_shareable(mid, vectors, cur, cur["version"], cur["base_version"])
    elif old_cat == "shareable":
        retract_payload = dict(cur)
        retract_payload["category"] = "shareable"
        retract_payload["deleted"] = True
        egress.enqueue_shareable(mid, vectors, retract_payload, cur["version"], cur["base_version"], op="delete")

    # Store technician correction in gate_feedback table (the on-device learning signal)
    try:
        db.execute(
            "INSERT INTO gate_feedback(memory_id, text, dense_json, model_category, user_category, ts) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                mid,
                cur["text"],
                json.dumps(vectors["dense"]),
                old_cat if old_source in ("llm", "fallback") else None,
                new_category,
                ts
            ),
        )
        db.execute("UPDATE gate_jobs SET status='cancelled' WHERE memory_id=? AND status='pending'", (mid,))
    except Exception as e:
        print(f"Correction logging notice: {e}")

    emit("gate.overridden", mid, {"old_category": old_cat, "new_category": new_category})
    return cur
