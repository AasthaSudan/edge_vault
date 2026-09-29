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
    from edge.llm.client import PrivacyError
    dummy_sparse = type("S", (), {"indices": [], "values": []})()
    with pytest.raises(PrivacyError):
        egress.enqueue_shareable(
            "x",
            {"dense": [0.0], "bm25": dummy_sparse},
            {"category": "private", "text": "hello"},
            1,
            0
        )


def test_egress_blocks_pii_in_shareable():
    from edge.privacy import egress
    from edge.llm.client import PrivacyError
    dummy_sparse = type("S", (), {"indices": [], "values": []})()
    with pytest.raises(PrivacyError):
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


def test_assistant_runs_offline_with_citations(monkeypatch, tmp_path):
    # Use isolated test device directory so it doesn't contend with running background daemon
    monkeypatch.setenv("DEVICE_ID", "device-test-offline")
    import importlib
    import edge.config as c
    importlib.reload(c)
    from edge.assistant import service

    events = list(service.ask(None, "how was the turbine bearing overheat fixed?"))
    assert len(events) >= 2
    assert events[0]["type"] == "sources"
    assert events[-1]["type"] == "done"
    assert "latency_ms" in events[-1]
