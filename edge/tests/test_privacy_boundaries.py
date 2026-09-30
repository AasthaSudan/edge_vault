import pathlib
import pytest


def test_llm_refuses_remote_host(monkeypatch):
    from edge.llm.client import PrivacyError
    import importlib
    import edge.config as c
    import edge.llm.client as client

    # First verify clean state passes
    client.assert_local()

    # Now set remote host and reload
    monkeypatch.setenv("LLM_HOST", "http://10.0.0.5:11434")
    importlib.reload(c)
    with pytest.raises(Exception) as exc_info:
        importlib.reload(client)
    assert "not loopback" in str(exc_info.value)

    # Clean up and restore loopback host
    monkeypatch.delenv("LLM_HOST", raising=False)
    importlib.reload(c)
    importlib.reload(client)


def test_egress_blocks_private():
    from edge.privacy import egress
    dummy_sparse = type("S", (), {"indices": [], "values": []})()
    # egress.PrivacyError: test_llm_refuses_remote_host reloads the client module, which
    # creates a new class object; match the one egress actually raises.
    with pytest.raises(egress.PrivacyError):
        egress.enqueue_shareable(
            "x",
            {"dense": [0.0], "bm25": dummy_sparse},
            {"category": "private", "text": "hello"},
            1,
            0
        )


def test_egress_blocks_pii_in_shareable():
    from edge.privacy import egress
    dummy_sparse = type("S", (), {"indices": [], "values": []})()
    # egress.PrivacyError: test_llm_refuses_remote_host reloads the client module, which
    # creates a new class object; match the one egress actually raises.
    with pytest.raises(egress.PrivacyError):
        egress.enqueue_shareable(
            "x",
            {"dense": [0.0], "bm25": dummy_sparse},
            {"category": "shareable", "text": "gate code is 4431"},
            1,
            0
        )


def test_only_egress_writes_outbox():
    root = pathlib.Path("edge/edge")
    offenders = [
        p for p in root.rglob("*.py")
        if p.parts[-2:] not in (("privacy", "egress.py"), ("sync", "outbox.py"))
        and ("outbox.enqueue" in p.read_text(encoding="utf-8")
             or "INSERT INTO outbox" in p.read_text(encoding="utf-8"))
    ]
    assert offenders == [], f"Offending modules writing to outbox: {offenders}"


def test_sync_never_touches_private_shard():
    for p in pathlib.Path("edge/edge/sync").glob("*.py"):
        src = p.read_text(encoding="utf-8")
        assert "shards.private" not in src and "import private" not in src, (
            f"Sync module {p} references private shard!"
        )


def test_assistant_runs_with_only_loopback():
    """The assistant (retrieval + local LLM) must work with every non-loopback host
    blocked (pytest-socket). Any attempt to reach the internet raises and fails."""
    from pytest_socket import socket_allow_hosts, enable_socket
    from edge.assistant import service
    from edge.memory import service as memories

    # Seed a source so the answer path (not just the refusal) exercises the local LLM
    memories.create(
        text="Turbine 4 bearing overheat fixed by replacing the oil filter and flushing with ISO 46 lube.",
        title="Turbine 4 Bearing Overheat Fix", asset_tag="TURBINE-04", category="private",
    )
    socket_allow_hosts(["127.0.0.1", "localhost", "::1"], allow_unix_socket=True)
    try:
        events = list(service.ask(None, "how was the turbine bearing overheat fixed?"))
    finally:
        enable_socket()
    assert events[0]["type"] == "sources"
    assert events[-1]["type"] == "done"
    assert "latency_ms" in events[-1]


def test_gate_fails_closed_without_llm(monkeypatch):
    """Spec §7.7: if the LLM cannot answer, the note is private, even a clean technical fix."""
    from edge.gate import gate
    from edge.llm import client

    def boom(*a, **k):
        raise RuntimeError("LLM offline")
    monkeypatch.setattr(client, "chat_json", boom)

    d = gate.decide_v2("P-200 cavitation noise fixed by replacing the worn impeller.", [0.01] * 384)
    assert d.category == "private"
    assert d.source == "fallback"
    assert "llm_unavailable" in d.flags
    assert d.sanitize_candidate  # still eligible for a human-approved Split & Share


def test_tombstone_carries_no_content(monkeypatch):
    """A delete/retraction must not ship the note's text or title to the cloud."""
    from edge.privacy import egress
    captured = {}
    monkeypatch.setattr(egress.outbox, "enqueue",
                        lambda mid, op, point, v, b: captured.update(op=op, point=point))
    dummy_sparse = type("S", (), {"indices": [], "values": []})()
    egress.enqueue_shareable(
        "x", {"dense": [0.0], "bm25": dummy_sparse},
        {"category": "shareable", "memory_id": "x", "title": "Gate", "text": "gate code is 4431",
         "gate_reason": "secret stuff", "version": 3},
        3, 2, op="delete",
    )
    pl = captured["point"]["payload"]
    assert captured["op"] == "delete"
    assert pl["deleted"] is True and pl["text"] == "" and pl["title"] == ""
    assert "gate_reason" not in pl and pl["version"] == 3


def test_new_sensitivity_rules():
    from edge.gate import pii
    assert "lock_combination" in pii.scan("Server rack access combination lock is set to 8821.")
    assert "sensitive_request" in pii.scan("Plant head asked to keep leak confidential: replaced diaphragm.")
    assert "named_person" in pii.scan("Guard Ramesh cleared debris blocking chiller intake fans.")
    # equipment language must stay clean
    for clean in ["Tightened lock nut on pump shaft to 120 Nm.", "Operator Panel B display replaced.",
                  "Fault code 4032 on VFD cleared after resetting.", "Customer Service module restarted."]:
        assert pii.scan(clean) == [], clean


def test_sanitizer_never_sees_secret_sentences():
    from edge.gate import pii
    from edge.gate.sanitize import redact
    out = redact("Gate code for Noida plant is 4431. P-200 seal leak fixed by replacing the lip seal with a Viton seal.")
    assert "4431" not in out and "Viton" in out
    assert pii.scan(redact("Guard Ramesh helped access roof: cleared debris blocking chiller intake fans.")) == []
