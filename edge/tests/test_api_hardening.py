"""HTTP-level hardening and input validation of the edge API (no Ollama, no cloud needed).

The edge serves PRIVATE notes on loopback, so it must not be usable from a web page the
technician happens to open: hosts are allow-listed (DNS rebinding) and browser writes must come
from the local dashboard (cross-site POSTs need no CORS preflight).
"""
import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from edge import db
from edge.assistant import service as assistant
from edge.main import app
from edge.memory import service
from edge.sync import connectivity

DASHBOARD = "http://localhost:3000"


@pytest.fixture(scope="module")
def client():
    # not used as a context manager: the lifespan (LLM warm-up, sync loop) is not needed here
    return TestClient(app)


# ---------------------------------------------------------------- host / origin protection

def test_unknown_host_is_rejected(client):
    """DNS rebinding: the attacker's page resolves its own domain to 127.0.0.1, so it can read responses."""
    assert client.get("/health", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/health", headers={"host": "localhost:7001"}).status_code == 200
    assert client.get("/health", headers={"host": "127.0.0.1:7001"}).status_code == 200


def test_cross_site_write_is_blocked_and_has_no_effect(client):
    assert not connectivity.forced_offline()
    r = client.post("/sync/offline?on=true", headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    assert not connectivity.forced_offline(), "the blocked request still executed"
    assert client.post("/sync/offline?on=true", headers={"origin": "null"}).status_code == 403  # sandboxed iframe / file://


def test_dashboard_and_scripts_can_still_write(client):
    try:
        assert client.post("/sync/offline?on=true", headers={"origin": DASHBOARD}).status_code == 200
        assert connectivity.forced_offline()
        assert client.post("/sync/offline?on=false").status_code == 200   # no Origin: curl, scripts, the demo runner
        assert not connectivity.forced_offline()
    finally:
        client.post("/sync/offline?on=false")


def test_reads_from_other_origins_are_not_blocked_by_the_write_guard(client):
    # reading is governed by CORS (the browser hides the response); the write guard must not interfere
    assert client.get("/health", headers={"origin": "http://evil.example"}).status_code == 200


# ---------------------------------------------------------------- input validation

@pytest.mark.parametrize("body", [{"q": "pump", "mode": "sparse"}, {"q": "pump", "limit": 0}, {"q": "pump", "limit": 5000}])
def test_search_rejects_bad_parameters(client, body):
    assert client.post("/search", json=body).status_code == 422


def _open_conflict() -> str:
    cid, mid = str(uuid.uuid4()), str(uuid.uuid4())
    local = {"memory_id": mid, "text": "Relief valve V-3 set pressure is 10 bar.", "device_id": "device-a"}
    remote = {"memory_id": mid, "text": "Relief valve V-3 set pressure is 12 bar.", "device_id": "device-b"}
    db.execute("INSERT INTO conflicts(id, memory_id, kind, local_json, remote_json, created_at) VALUES (?, ?, 'version', ?, ?, ?)",
               (cid, mid, json.dumps(local), json.dumps(remote), int(time.time() * 1000)))
    return cid


@pytest.mark.parametrize("body, needle", [
    ({"resolution": "merged", "merged_text": ""}, "empty"),
    ({"resolution": "merged", "merged_text": "   "}, "empty"),
    ({"resolution": "merged"}, "empty"),
    ({"resolution": "merged", "merged_text": "V-3 relief set to 12 bar, call Suresh on +91 98765 43210"}, "sensitive"),
])
def test_bad_merge_is_refused_before_anything_reaches_the_cloud(client, body, needle):
    """An empty merge used to resolve silently as keep_remote; typed-in PII used to be POSTed to the
    cloud (and stored as fleet text) before the local PII scan ran."""
    cid = _open_conflict()
    r = client.post(f"/conflicts/{cid}/resolve", json=body)
    assert r.status_code == 400 and needle in r.json()["detail"].lower(), r.text
    still_open = db.execute("SELECT status FROM conflicts WHERE id=?", (cid,)).fetchone()["status"]
    assert still_open == "open"


def test_unknown_resolution_is_rejected(client):
    assert client.post(f"/conflicts/{_open_conflict()}/resolve", json={"resolution": "whatever"}).status_code == 422


# ---------------------------------------------------------------- assistant

def _seed_note() -> None:
    service.create(text="Turbine 4 bearing overheat fixed by replacing the oil filter and flushing with ISO 46 lube.",
                   title="Turbine 4 Bearing Overheat Fix", asset_tag="TURBINE-04", category="private", dedup=False)


QUESTION = "how was the turbine bearing overheat fixed?"


def _run_ask() -> tuple[str, list[dict]]:
    events = list(assistant.ask(None, QUESTION))
    done = events[-1]
    assert done["type"] == "done"
    return done["text"], events


def test_failed_llm_stream_is_replaced_by_the_fallback_not_appended_to(monkeypatch):
    _seed_note()

    def dies_midway(_msgs):
        yield "The bearing was fixed by PARTIALMODELTEXT"
        raise RuntimeError("Ollama restarted")
    monkeypatch.setattr(assistant.llm, "chat_stream", dies_midway)

    text, _ = _run_ask()
    assert "PARTIALMODELTEXT" not in text, "half an LLM answer was glued to the fallback"
    assert text.strip()


def test_empty_llm_stream_falls_back_instead_of_answering_nothing(monkeypatch):
    _seed_note()
    monkeypatch.setattr(assistant.llm, "chat_stream", lambda _msgs: iter(["", "  "]))
    text, _ = _run_ask()
    assert text.strip(), "an empty model reply produced an empty answer"


def test_only_assistant_answers_can_be_saved_as_memories(client):
    _seed_note()
    _, _ = _run_ask()
    user_msg = db.execute("SELECT id FROM chat_messages WHERE role='user' ORDER BY created_at DESC LIMIT 1").fetchone()["id"]
    assert client.post(f"/assistant/messages/{user_msg}/save").status_code == 400
    assert client.post("/assistant/messages/does-not-exist/save").status_code == 404
