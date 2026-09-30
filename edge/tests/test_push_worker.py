"""The edge push worker (edge/sync/push.py) against a scripted cloud (httpx.MockTransport).

Covers what the cloud-side integration test cannot: what the edge does with a reply that is not
what it expected, and how it stores conflicts the cloud returns.
"""
import asyncio
import json
import time
import uuid

import httpx
import pytest

from edge import db
from edge.sync import outbox, push


def _row(mid: str) -> None:
    point = {"id": mid, "vector": {"dense": [0.1], "bm25": {"indices": [], "values": []}},
             "payload": {"memory_id": mid, "text": "x", "category": "shareable"}}
    outbox.enqueue(mid, "upsert", point, 1, 0)


def _status(mid: str) -> list[tuple[str, int]]:
    rows = db.execute("SELECT status, attempts FROM outbox WHERE memory_id=?", (mid,)).fetchall()
    return [(r["status"], r["attempts"]) for r in rows]


def _conflict(cid: str, mid: str, local_text: str) -> dict:
    return {"id": cid, "memory_id": mid, "kind": "version", "status": "open", "created_at": int(time.time() * 1000),
            "local": {"memory_id": mid, "text": local_text}, "remote": {"memory_id": mid, "text": "the other device's edit"}}


def _run(handler):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await push.push_once(client)
    return asyncio.run(go())


def _drain():
    """Other tests leave pending rows on this throwaway device; start from an empty queue."""
    db.execute("UPDATE outbox SET status='done' WHERE status IN ('pending', 'inflight')")


def test_a_reply_that_is_not_json_releases_the_rows_instead_of_stranding_them():
    """A captive portal answers POST /push with 200 + HTML. The rows were claimed ('inflight') before
    the reply was parsed; a failure there used to leave them inflight forever, so nothing was resent
    and pull (which waits for an empty queue) never ran again."""
    _drain()
    mid = str(uuid.uuid4())
    _row(mid)

    with pytest.raises(Exception):
        _run(lambda request: httpx.Response(200, text="<html>Sign in to the network</html>"))

    assert _status(mid) == [("pending", 1)]
    assert outbox.depth() == 1


def test_a_bad_conflict_in_the_reply_does_not_lose_the_batch():
    _drain()
    mid = str(uuid.uuid4())
    _row(mid)

    with pytest.raises(Exception):
        _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [{"id": "broken"}]}))

    assert _status(mid) == [("pending", 1)], "rows were acked although their conflict could not be stored"


def test_conflicts_are_stored_before_the_rows_are_acked():
    _drain()
    mid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    _row(mid)

    _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [_conflict(cid, mid, "A first edit")]}))

    row = db.execute("SELECT status, local_json FROM conflicts WHERE id=?", (cid,)).fetchone()
    assert row["status"] == "open" and json.loads(row["local_json"])["text"] == "A first edit"
    assert _status(mid) == [("done", 0)]


def test_a_second_edit_updates_the_open_conflict_and_drops_the_stale_analysis():
    _drain()
    mid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    _row(mid)
    _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [_conflict(cid, mid, "A first edit")]}))
    db.execute("UPDATE conflicts SET analysis_json=? WHERE id=?", (json.dumps({"relation": "progression"}), cid))

    _row(mid)   # the technician edited the note again while the conflict was open
    _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [_conflict(cid, mid, "A newest edit")]}))

    row = db.execute("SELECT local_json, analysis_json FROM conflicts WHERE id=?", (cid,)).fetchone()
    assert json.loads(row["local_json"])["text"] == "A newest edit"
    assert row["analysis_json"] is None, "the AI analysis of the older text was kept"
    opened = db.execute("SELECT COUNT(*) FROM events WHERE type='conflict.opened' AND memory_id=?", (mid,)).fetchone()[0]
    assert opened == 1, "the same conflict was announced twice"


def test_a_resolved_conflict_is_not_reopened_or_rewritten():
    _drain()
    mid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    _row(mid)
    _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [_conflict(cid, mid, "A first edit")]}))
    db.execute("UPDATE conflicts SET status='resolved', resolution='keep_local' WHERE id=?", (cid,))

    _row(mid)
    _run(lambda request: httpx.Response(200, json={"accepted": [], "conflicts": [_conflict(cid, mid, "late echo")]}))

    row = db.execute("SELECT status, local_json FROM conflicts WHERE id=?", (cid,)).fetchone()
    assert row["status"] == "resolved" and json.loads(row["local_json"])["text"] == "A first edit"
