"""Regression tests for note lifecycle bugs found in the repo audit.

Each test reproduces a concrete failure: retracting a note must stop its text leaving the
device, the async gate must not overwrite what the technician did while the LLM was
thinking, routine TTL and listing must work past one page, the SSE feed must be wired up.
No test needs Ollama: the gate verdict is stubbed where the gate is involved.
"""
import asyncio
import pathlib
import time
import uuid

import pytest
from qdrant_edge import UpdateOperation

from edge import db, events
from edge.gate import gate as gatemod
from edge.memory import service, ttl
from edge.memory.models import SearchRequest
from edge.privacy import egress


def _tag() -> str:
    return f"T-{uuid.uuid4().hex[:8]}"


def _outbox(mid: str) -> list[tuple[str, str]]:
    rows = db.execute("SELECT op, status FROM outbox WHERE memory_id=? ORDER BY id", (mid,)).fetchall()
    return [(r["op"], r["status"]) for r in rows]


def _in_shard(sh, mid: str) -> bool:
    with sh.lock:
        return bool(sh.shard.retrieve([mid], True, False))


@pytest.fixture
def async_gate(monkeypatch):
    monkeypatch.setattr(service.settings, "gate_mode", "async")


def _pending_note(tag: str) -> dict:
    """A provisional private note waiting for the gate (what POST /memories returns)."""
    note = service.create(text="Seal on the pump replaced after cavitation noise.", asset_tag=tag, dedup=False)
    assert note["gate_source"] == "pending" and note["category"] == "private"
    return note


def _shareable_verdict() -> gatemod.GateDecision:
    return gatemod.GateDecision(category="shareable", source="llm", reason="stub", signals=["equipment_fix"])


# ---------------------------------------------------------------- retraction / egress

def test_retracting_before_sync_cancels_the_queued_upsert():
    """Shared then taken back while offline: the full text must never be pushed."""
    note = service.create(text="Pump seal replaced with a Viton seal, verified no leak.",
                          asset_tag=_tag(), category="shareable", dedup=False)
    mid = note["memory_id"]
    assert _outbox(mid) == [("upsert", "pending")]

    service.change_category(mid, "private")

    assert _outbox(mid) == [("upsert", "cancelled"), ("delete", "pending")]


def test_editing_pii_into_a_shared_note_cancels_the_queued_upsert():
    note = service.create(text="Pump seal replaced with a Viton seal, verified no leak.",
                          asset_tag=_tag(), category="shareable", dedup=False)
    mid = note["memory_id"]

    edited = service.update(mid, text="Seal replaced. Call Suresh on +91 98765 43210 for the invoice.")

    assert edited["category"] == "private"
    assert _outbox(mid) == [("upsert", "cancelled"), ("delete", "pending")]


def test_tombstone_vectors_say_nothing_about_the_retracted_text(monkeypatch):
    captured = {}
    monkeypatch.setattr(egress.outbox, "enqueue", lambda mid, op, point, v, b: captured.update(point=point))
    real = {"dense": [0.1 * (i % 7) for i in range(384)],
            "bm25": type("S", (), {"indices": [11, 42, 97], "values": [1.0, 2.0, 3.0]})()}

    egress.enqueue_shareable("x", real, {"category": "shareable", "memory_id": "x", "text": "secret fix", "version": 2},
                             2, 1, op="delete")

    vec = captured["point"]["vector"]
    assert len(set(vec["dense"])) == 1 and len(vec["dense"]) == 384      # constant, not the note's embedding
    assert vec["bm25"] == {"indices": [], "values": []}                  # no token hashes


def _dummy_vectors():
    return {"dense": [0.0], "bm25": type("S", (), {"indices": [], "values": []})()}


def test_egress_refuses_pii_in_the_asset_tag():
    with pytest.raises(egress.PrivacyError):
        egress.enqueue_shareable("x", _dummy_vectors(),
                                 {"category": "shareable", "text": "Seal replaced on the pump.", "asset_tag": "call 555-123-4567"}, 1, 0)


def test_egress_replaces_a_gate_reason_that_echoes_sensitive_text(monkeypatch):
    sent = []
    monkeypatch.setattr(egress.outbox, "enqueue", lambda mid, op, point, v, b: sent.append(point["payload"]))
    base = {"category": "shareable", "text": "Seal replaced on the pump.", "asset_tag": "P-200"}

    egress.enqueue_shareable("x", _dummy_vectors(), {**base, "gate_reason": "Neighbour says the gate code is 4431"}, 1, 0)
    egress.enqueue_shareable("y", _dummy_vectors(), {**base, "gate_reason": "Operational procedure with a clear fix"}, 1, 0)

    assert sent[0]["gate_reason"] == "Classified on device"
    assert sent[1]["gate_reason"] == "Operational procedure with a clear fix"


# ---------------------------------------------------------------- async gate races

def test_gate_verdict_does_not_resurrect_a_deleted_note(monkeypatch, async_gate):
    note = _pending_note(_tag())
    mid = note["memory_id"]

    def slow_llm_that_loses_the_race(*a, **k):
        service.delete(mid)                    # the technician deletes while the LLM is thinking
        return _shareable_verdict()
    monkeypatch.setattr(service.gatemod, "decide_v2", slow_llm_that_loses_the_race)

    service.finalize(mid, note["text"], "", note["asset_tag"], note["created_at"], provisional=True, dedup=False)

    assert service.get(mid)[1] is None, "a deleted note came back"
    assert _outbox(mid) == [], "a deleted note was queued for the fleet"


def test_gate_verdict_does_not_override_a_manual_share(monkeypatch, async_gate):
    note = _pending_note(_tag())
    mid = note["memory_id"]

    def llm_says_private_after_user_shared(*a, **k):
        service.change_category(mid, "shareable")
        return gatemod.GateDecision(category="private", source="llm", reason="stub")
    monkeypatch.setattr(service.gatemod, "decide_v2", llm_says_private_after_user_shared)

    service.finalize(mid, note["text"], "", note["asset_tag"], note["created_at"], provisional=True, dedup=False)

    assert _in_shard(service.shared, mid) and not _in_shard(service.private, mid), "note now lives in both shards"
    assert service.get(mid)[1].payload["gate_source"] == "user"


def test_keeping_a_pending_note_private_sticks(monkeypatch, async_gate):
    note = _pending_note(_tag())
    mid = note["memory_id"]

    kept = service.change_category(mid, "private")           # "keep private" while still classifying
    assert kept["gate_source"] == "user"

    monkeypatch.setattr(service.gatemod, "decide_v2", lambda *a, **k: _shareable_verdict())
    service.finalize(mid, note["text"], "", note["asset_tag"], note["created_at"], provisional=True, dedup=False)

    assert _in_shard(service.private, mid) and not _in_shard(service.shared, mid)
    assert _outbox(mid) == []


def test_edit_during_classification_is_not_overwritten(monkeypatch, async_gate):
    note = _pending_note(_tag())
    mid = note["memory_id"]
    edited_text = "Seal on the pump replaced; also cleaned the suction strainer."

    def llm_while_user_edits(*a, **k):
        service.update(mid, text=edited_text)
        return _shareable_verdict()
    monkeypatch.setattr(service.gatemod, "decide_v2", llm_while_user_edits)
    jobs = lambda: db.execute("SELECT COUNT(*) FROM gate_jobs WHERE memory_id=? AND kind='classify' AND status='pending'",
                              (mid,)).fetchone()[0]
    before = jobs()

    service.finalize(mid, note["text"], "", note["asset_tag"], note["created_at"], provisional=True, dedup=False)

    live = service.get(mid)[1].payload
    assert live["text"] == edited_text, "the edit was overwritten by the stale verdict"
    assert live["category"] == "private" and live["gate_source"] == "pending"
    assert jobs() == before + 1, "the edited text was not queued for classification"


# ---------------------------------------------------------------- TTL and listing

def test_moving_a_note_to_routine_sets_expiry_and_leaving_clears_it():
    note = service.create(text="Reached the pump house, starting the shift inspection.", asset_tag=_tag(),
                          category="private", dedup=False)
    mid = note["memory_id"]
    assert note["expires_at"] is None

    routine = service.change_category(mid, "routine")
    ttl_ms = service.settings.routine_ttl_days * 86400 * 1000
    assert abs(routine["expires_at"] - (int(time.time() * 1000) + ttl_ms)) < 60_000

    assert service.change_category(mid, "private")["expires_at"] is None, "stale expiry followed the note"


def test_ttl_sweep_reads_every_page(monkeypatch):
    monkeypatch.setattr(ttl, "_PAGE", 2)
    tag, ids = _tag(), []
    for i in range(5):
        n = service.create(text=f"Shift {i} inspection done, nothing to report on unit {tag}.", asset_tag=tag,
                           category="routine", dedup=False)
        ids.append(n["memory_id"])
    with service.private.lock:
        service.private.shard.update(UpdateOperation.set_payload(ids, {"expires_at": 1}))

    swept = ttl.sweep_expired_routine()

    assert swept >= 5
    assert all(service.get(i)[1] is None for i in ids), "expired notes beyond the first page survived"


def test_list_memories_returns_the_newest_notes_and_pages_cleanly(monkeypatch):
    monkeypatch.setattr(service, "_SCROLL_PAGE", 3)
    tag = _tag()
    for i in range(8):
        service.create(text=f"Inspection round {i}: unit healthy, no action needed.", asset_tag=tag,
                       category="private", dedup=False)
        time.sleep(0.005)  # distinct updated_at

    everything = service.list_memories(asset_tag=tag, limit=50)
    assert len(everything) == 8
    stamps = [m["updated_at"] for m in everything]
    assert stamps == sorted(stamps, reverse=True), "not newest first"

    page1 = service.list_memories(asset_tag=tag, limit=3, offset=0)
    page2 = service.list_memories(asset_tag=tag, limit=3, offset=3)
    assert page1 == everything[:3], "first page is not the newest three"
    assert page2 == everything[3:6], "second page skipped or repeated notes"


def test_deleted_notes_are_not_listed():
    tag = _tag()
    keep = service.create(text="Bearing greased on unit, all good.", asset_tag=tag, category="private", dedup=False)
    gone = service.create(text="Filter swapped on unit, all good.", asset_tag=tag, category="private", dedup=False)
    service.delete(gone["memory_id"])
    assert [m["memory_id"] for m in service.list_memories(asset_tag=tag)] == [keep["memory_id"]]


# ---------------------------------------------------------------- search input, SSE

@pytest.mark.parametrize("bad", [{"mode": "sparse"}, {"limit": 0}, {"limit": 100000}])
def test_search_rejects_bad_input(bad):
    with pytest.raises(Exception):
        SearchRequest(q="pump", **bad)


def test_search_defaults_are_valid():
    r = SearchRequest(q="pump")
    assert r.mode == "hybrid" and r.limit == 10
    assert SearchRequest(q="pump", mode="bm25", limit=100).mode == "bm25"


def test_events_reach_subscribers_from_a_worker_thread():
    """emit() is called from the gate/sync worker threads; it needs the bound loop to deliver."""
    async def run():
        loop = asyncio.get_running_loop()
        events.bind_loop(loop)
        q = events.subscribe()
        try:
            await loop.run_in_executor(None, events.emit, "unit.test", None, {"k": 1})
            return await asyncio.wait_for(q.get(), timeout=3)
        finally:
            events.unsubscribe(q)
    ev = asyncio.run(run())
    assert ev["type"] == "unit.test" and ev["data"] == {"k": 1}


def test_app_binds_the_event_loop_at_startup():
    # Nothing else calls bind_loop: without this line /events never carries a real event.
    assert "events.bind_loop(" in pathlib.Path("edge/edge/main.py").read_text(encoding="utf-8")
