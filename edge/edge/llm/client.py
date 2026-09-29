"""The ONLY module allowed to talk to the language model.

Guarantees:
- The host is loopback, and cloud-hosted model tags are refused (NFR-09).
- One generation at a time (CPU), with a fixed num_ctx so the model never reloads.
"""
import json
import threading
import time
from urllib.parse import urlparse
from ollama import Client
from edge.config import settings

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


class PrivacyError(RuntimeError):
    pass


def assert_local() -> None:
    parsed = urlparse(settings.llm_host)
    host = parsed.hostname or settings.llm_host.split(":")[0]
    if host not in LOOPBACK:
        raise PrivacyError(f"LLM host '{host}' is not loopback; refusing to start.")
    if "cloud" in settings.ollama_model.lower():
        raise PrivacyError("Cloud-hosted model tags are not allowed on an edge node.")


assert_local()  # fail at import time: the node cannot even boot misconfigured

_client = Client(host=settings.llm_host, timeout=settings.llm_timeout_s)
_slot = threading.Lock()
_stats = {"calls": 0, "errors": 0, "last_ms": None, "p95_window": []}

BASE_OPTIONS = {"temperature": 0, "seed": 42, "num_ctx": settings.llm_num_ctx}


def _record(ms: float, ok: bool) -> None:
    _stats["calls"] += 1
    if not ok:
        _stats["errors"] += 1
    _stats["last_ms"] = round(ms, 1)
    w = _stats["p95_window"]
    w.append(ms)
    del w[:-50]


_offline_until = 0.0


def chat_json(messages: list[dict], schema: dict, num_predict: int = 120) -> dict:
    """Deterministic structured call. Raises on invalid JSON; callers fail closed."""
    global _offline_until
    if time.time() < _offline_until:
        raise RuntimeError("LLM is currently offline")
    t0 = time.perf_counter()
    ok = False
    try:
        with _slot:
            resp = _client.chat(
                model=settings.ollama_model,
                messages=messages,
                format=schema,
                options={**BASE_OPTIONS, "num_predict": num_predict},
                keep_alive=settings.llm_keep_alive,
            )
        out = json.loads(resp.message.content)
        ok = True
        return out
    except Exception:
        _offline_until = time.time() + 2.0
        raise
    finally:
        _record((time.perf_counter() - t0) * 1000, ok)


def chat_stream(messages: list[dict], num_predict: int = 350):
    """Token stream for the assistant. Holding the slot while streaming is intended.
    If the client disconnects, the generator closes and the lock is released."""
    global _offline_until
    if time.time() < _offline_until:
        raise RuntimeError("LLM is currently offline")
    t0 = time.perf_counter()
    ok = False
    try:
        with _slot:
            for chunk in _client.chat(
                model=settings.ollama_model,
                messages=messages,
                stream=True,
                options={**BASE_OPTIONS, "temperature": 0.1, "num_predict": num_predict},
                keep_alive=settings.llm_keep_alive,
            ):
                piece = chunk.message.content
                if piece:
                    yield piece
        ok = True
    except Exception:
        _offline_until = time.time() + 2.0
        raise
    finally:
        _record((time.perf_counter() - t0) * 1000, ok)


def warmup() -> None:
    """Load the model into RAM at startup so the first demo click is instant."""
    try:
        with _slot:
            _client.chat(
                model=settings.ollama_model,
                messages=[{"role": "user", "content": "ok"}],
                options={**BASE_OPTIONS, "num_predict": 1},
                keep_alive=settings.llm_keep_alive,
            )
    except Exception:
        pass  # the gate fails closed; the assistant shows "model offline"


def stats() -> dict:
    w = sorted(_stats["p95_window"])
    p95 = w[int(len(w) * 0.95) - 1] if w else None
    return {**{k: v for k, v in _stats.items() if k != "p95_window"}, "p95_ms": p95}


def loaded_models() -> list[dict]:
    try:
        return [{"name": m.model, "size": m.size} for m in _client.ps().models]
    except Exception:
        return []
