# Phase 5: Local Intelligence Layer (On-Device LLM)

> **Timeline:** 5–9 Oct (runs in parallel with Phase 3/4 by one owner; merged into the demo on 9–10 Oct)
> **Goal:** A small local LLM (via Ollama) becomes the device's brain in two ways. First, it classifies every note using the context of what the device already knows and what the technician has corrected before. Second, it answers any question about the device's memory, private data included, without a single byte leaving the device.
> **Exit Criterion:** With Wi-Fi physically off, a technician asks a question that needs both a private note and fleet knowledge. The device gives a cited answer. A mixed note is auto-split into a private original plus an approved sanitized fact that syncs to Device B. `GET /stats` still returns `private_on_server = 0`.
> **Principle:** *Everything the model sees stays on the device. Only facts that pass every privacy gate cross to the cloud.*

---

## 0. What This Phase Adds (in one screen)

| # | Capability | What changes vs. Phase 2 | Why judges care |
|---|---|---|---|
| **5A** | **Context-aware Gate v2** | The LLM classifies with the 4 most similar notes already on the device and the technician's past corrections as live few-shot examples. It also outputs *signals* (credential, person, equipment_fix, …) that deterministic veto rules check. | Addresses the problem statement's goals "dynamically decide what stays local" and "handle evolving memory". The gate improves on-device from user corrections, and the corrections themselves never leave the device. |
| **5B** | **Ask EdgeVault (local RAG assistant)** | A chat panel answers questions over the **private + shared** shards, with numbered citations. It runs fully offline, and chat history lives only in local SQLite. | Addresses the problem statement's goals "reason over locally generated information" and "meaningful edge-to-cloud workflow". Private context and fleet knowledge are fused on the device. |
| **5C** | **Split & Share** | When a note mixes a reusable fix with private details, the note stays private. The LLM proposes a **sanitized one-line fact**. That fact must pass the PII re-scan, a grounding check and the gate again, and then the technician must approve it before it syncs. | The hero demo moment. Knowledge flows to the fleet while secrets stay put. |
| **5D** | **Privacy hardening** | Adds a loopback-only LLM guard, a final egress guard on the outbox, taint propagation (answers built from private sources stay private), and automated boundary tests. | Turns "we promise privacy" into "here is the test that proves it". |
| **5E** | **Async gate (fail-closed by construction)** | Notes are written instantly as provisional `private`. The LLM classifies in the background and *promotes* the note if it is shareable. | Removes LLM latency from the write path. A crash or timeout leaves data private, never leaked. |

> [!NOTE]
> Your Phase 2 spec already routes notes through `gemma3:1b` via Ollama. If your running build currently classifies with rules or text heuristics only, the LLM call is either not wired in or silently hitting the fail-closed fallback. Check the `gate_source` values in the Memory Inspector: if you only ever see `rule` and `fallback`, the LLM never answered. Phase 5 replaces that path completely, so you don't need to debug the old one first.

---

## 1. Model Choice

"Small model through Ollama" in practice means **1–2 billion parameters, 4-bit quantized, about 1 GB of RAM**. Below 1B, quality drops sharply on anything but the simplest classification. Use **one model for everything** (gate, sanitizer, assistant). Loading two models on a laptop CPU doubles RAM use and causes reload stalls in the middle of the demo.

| Model (Ollama tag) | Size on disk | Context | Role in EdgeVault | Verdict |
|---|---|---|---|---|
| **`qwen2.5:1.5b`** | ~1 GB | 32K | Gate + sanitizer + assistant | **Default pick.** Reliable JSON with `format=` schemas, good instruction following, fast on CPU. |
| `gemma3:1b` | ~0.8 GB | 32K | Same | **Lightweight fallback.** Already in your config. Text-only at 1B. Use it if the demo laptop has 8 GB RAM or less. |
| `llama3.2:1b` | ~1.3 GB | 128K | Same | Good alternative. Very fast on CPU, decent tool/JSON behaviour. |
| `qwen3.5:2b` | ~1.5–2 GB | 256K | Assistant quality upgrade | **Benchmark before adopting.** Newer family. If the tag supports thinking, disable it (`think=False`) for latency. |

**Decision rule:** run `scripts/bench_models.py` (§7.13) on the actual demo laptop on 5 Oct. Pick the model with **zero false shareables** first, then the lowest p95 latency, then the highest accuracy. Don't pick on vibes.

### 1.1 Ollama setup (Windows / PowerShell)

```powershell
# Pull while online (once)
ollama pull qwen2.5:1.5b
ollama pull gemma3:1b          # fallback

# Server settings (set once, then restart the Ollama app)
setx OLLAMA_HOST "127.0.0.1:11434"      # loopback only; never 0.0.0.0 on the demo laptop
setx OLLAMA_NUM_PARALLEL 1              # CPU: one generation at a time, requests queue
setx OLLAMA_MAX_LOADED_MODELS 1         # never hold two models in RAM
setx OLLAMA_KEEP_ALIVE "30m"            # keep the model resident between calls

# Verify it runs with Wi-Fi OFF
ollama run qwen2.5:1.5b "reply with the word ok"
ollama ps                               # shows the loaded model and its RAM
```

> [!WARNING]
> **Two latency traps with small local models:**
> 1. **Changing `num_ctx` between calls reloads the model** (several seconds). Every call in this phase uses the same `num_ctx` (4096), set in one place.
> 2. **Prompt prefill dominates on CPU.** A 900-token few-shot prompt can take longer than generating 60 tokens. The gate prompt keeps a **static prefix** (system prompt + fixed examples) and puts dynamic context **at the end**, so Ollama can reuse its prompt cache for the unchanged prefix.

---

## 2. Requirements Covered

| ID | Type | Description | Priority |
|---|---|---|---|
| **FR-23** | Functional | Gate v2 retrieves the top-k similar on-device notes and the most relevant past corrections, and includes them as dynamic few-shot context. | Must |
| **FR-24** | Functional | Gate v2 outputs `category`, `signals[]` and `reason`. Deterministic veto rules can downgrade `shareable` to `private` but can never upgrade anything to `shareable`. | Must |
| **FR-25** | Functional | Every user override is stored locally as a correction and reused as few-shot context for future classifications. | Must |
| **FR-26** | Functional | Local assistant answers questions from private + shared shards with numbered citations mapped to memory IDs. It refuses when the memory has no answer. | Must |
| **FR-27** | Functional | Assistant scope switch: `device` (private + shared) or `fleet` (shared only). | Should |
| **FR-28** | Functional | Chat sessions are stored in local SQLite with a retention sweep (default 7 days). They are never enqueued, pushed or exported. | Must |
| **FR-29** | Functional | Split & Share: a private note with technical signals produces a sanitized suggestion. It becomes a shareable memory only after the PII re-scan, grounding check and gate re-check pass **and** a human approves it. | Must |
| **FR-30** | Functional | Taint propagation: saving an assistant answer as a memory forces `private` if any cited source is private or routine. | Must |
| **FR-31** | Functional | Async gate: non-rule notes are written as provisional `private` (`gate_source = "pending"`) and finalized by a persisted background job queue. | Should |
| **FR-32** | Functional | Dashboard adds an Assistant page, a Share Suggestions inbox, LLM status in the top bar, and a gate explanation showing signals and the context used. | Must |
| **NFR-09** | Non-Functional | The LLM host must be a loopback address and the model tag must not be a cloud-hosted variant. Otherwise the edge node refuses to start. | Must |
| **NFR-10** | Non-Functional | Final egress guard: every outbox write re-checks `category == "shareable"` and runs the PII scan. Violations are blocked and emit `privacy.blocked`. | Must |
| **NFR-11** | Non-Functional | Assistant first token < 2.5 s and full answer < 12 s on the demo laptop CPU (measure and report; don't assume). | Target |
| **NFR-12** | Non-Functional | Gate v2 finalization p95 < 3 s in async mode. Accuracy ≥ 90%, **false shareables = 0**, **flips = 0** across 5 runs on the 40-item eval set. | Must |
| **NFR-13** | Non-Functional | Sync modules have no import path to the assistant, chat tables, gate context or the private shard, enforced by an automated test. | Must |

---

## 3. Architecture

```
┌──────────────────────────────────── EDGE DEVICE ──────────────────────────────────────┐
│                                                                                        │
│   Technician ──► POST /memories ─────────────┐        ┌─── POST /assistant/ask ◄── Tech │
│                                              ▼        ▼                                │
│                                     ┌──────────────────────────┐                       │
│                                     │   Local LLM (Ollama)     │  127.0.0.1:11434 only │
│                                     │   qwen2.5:1.5b           │  one slot, keep-alive │
│                                     └──────▲───────────▲───────┘                       │
│                                            │           │                               │
│   ┌─────────────── GATE v2 ────────────────┴──┐   ┌────┴──────── ASSISTANT ───────────┐ │
│   │ 1 PII rules (instant, unconditional)      │   │ 1 Hybrid retrieve (private+shared)│ │
│   │ 2 Write provisional PRIVATE               │   │ 2 Numbered context, token budget  │ │
│   │ 3 Job queue ─► context: neighbours +      │   │ 3 Stream answer, parse [n] cites  │ │
│   │   corrections ─► LLM {category, signals}  │   │ 4 Store turn in local chat tables │ │
│   │ 4 Veto policy (can only DOWNGRADE)        │   │ 5 "Save as memory" ─► TAINT rule  │ │
│   │ 5 Promote / TTL / keep private            │   └───────────────────────────────────┘ │
│   │ 6 Private + tech signals ─► SANITIZER ────┼──► Share Suggestions (needs approval)   │
│   └───────────────┬───────────────────────────┘                  │ approve              │
│                   ▼                                              ▼                      │
│   ┌──────────────┐        ┌──────────────┐        ┌────────────────────────────┐        │
│   │Private Shard │        │ Shared Shard │◄───────│  EGRESS GUARD (NFR-10)     │        │
│   │ + chat (SQL) │        │              │        │  shareable? PII-clean?     │        │
│   │ + corrections│        └──────▲───────┘        └─────────────┬──────────────┘        │
│   └──────────────┘               │ pull                         ▼                       │
│      NEVER READ BY SYNC          │                        Outbox (SQLite)               │
└──────────────────────────────────┼──────────────────────────────┼───────────────────────┘
                                   │                              │ push
                            ┌──────┴──────────────────────────────▼──────┐
                            │ Cloud Sync API ─► Qdrant Server (shared)   │
                            └────────────────────────────────────────────┘
```

### 3.1 The Five Privacy Rules of Phase 5

1. **Local model, local host.** The LLM client refuses any non-loopback host and any model tag containing `cloud` (NFR-09).
2. **The LLM can only make things *more* private.** Veto rules may turn `shareable` into `private`. Nothing the model says can override a PII rule hit.
3. **One door to the cloud.** Only `privacy/egress.py` may call `outbox.enqueue`. It re-checks the category and runs the PII scan on every item (NFR-10).
4. **Derived content inherits its sources' restrictions (taint).** An answer built from a private note is private. A sanitized suggestion needs a human click before it crosses.
5. **Chat is not memory.** Chat turns live in `chat_messages`, which sync never touches. An answer becomes memory only when the technician clicks "Save", and then it goes through the gate and the taint rule.

---

## 4. Directory & File Structure (Phase 5 Additions)

```
edgevault/
├── .importlinter                         # NEW: architectural privacy contracts
└── edge/
    ├── scripts/
    │   └── bench_models.py               # NEW: pick the model by data
    ├── tests/
    │   ├── gate_eval_v2.jsonl            # NEW: 40 items incl. 10 mixed notes
    │   ├── eval_gate.py                  # UPDATED: v1 vs v2, per-model report
    │   ├── assistant_eval.jsonl          # NEW: 15 answerable + 5 unanswerable questions
    │   ├── eval_assistant.py             # NEW: retrieval hit@k, citation validity, refusals
    │   ├── test_privacy_boundaries.py    # NEW: loopback guard, egress guard, socket block
    │   └── test_taint.py                 # NEW
    └── edge/
        ├── config.py                     # UPDATED: LLM + assistant settings
        ├── schema.sql                    # UPDATED: 5 new tables
        ├── llm/
        │   ├── __init__.py
        │   ├── client.py                 # NEW: loopback guard, single slot, JSON + stream
        │   └── status.py                 # NEW: loaded model, latency stats
        ├── gate/
        │   ├── pii.py                    # unchanged
        │   ├── prompts.py                # UPDATED: v2 schema with signals, stable prefix
        │   ├── context.py                # NEW: neighbours + similar corrections
        │   ├── policy.py                 # NEW: downgrade-only veto rules
        │   ├── gate.py                   # UPDATED: decide_v2()
        │   ├── sanitize.py               # NEW: Split & Share
        │   └── worker.py                 # NEW: persisted async job queue
        ├── memory/
        │   ├── service.py                # UPDATED: provisional write + finalize()
        │   └── taint.py                  # NEW
        ├── privacy/
        │   ├── __init__.py
        │   └── egress.py                 # NEW: the only door to the outbox
        ├── assistant/
        │   ├── __init__.py
        │   ├── retrieve.py               # NEW: hybrid retrieval + asset-tag boost
        │   ├── prompts.py                # NEW
        │   ├── sessions.py               # NEW: local chat storage + retention
        │   └── service.py                # NEW: ask() generator
        └── api/
            ├── assistant.py              # NEW: /assistant/*
            ├── suggestions.py            # NEW: /suggestions/*
            ├── llm.py                    # NEW: /llm/status
            └── memories.py               # UPDATED: override writes a correction

dashboard/
├── app/
│   ├── assistant/page.tsx                # NEW: chat with citation chips
│   └── suggestions/page.tsx              # NEW: Split & Share inbox
├── components/
│   ├── CitationChip.tsx                  # NEW
│   ├── LlmStatus.tsx                     # NEW: top-bar model badge
│   └── GateBadge.tsx                     # UPDATED: signals + context used
└── lib/
    └── stream.ts                         # NEW: NDJSON stream reader
```

---

## 5. Step-by-Step Implementation Tasks

Tasks are ordered by dependency. The **cut line** (§11) says what to drop if time runs out.

- [ ] **Task 5.1: Config, schema and LLM client** (0.5 day)
  - Add the settings in §7.1 and the tables in §7.2. Implement `llm/client.py` with the loopback guard, a single generation slot, `chat_json()`, `chat_stream()` and `warmup()`.
  - Replace the Phase 2 `ollama.Client` in `gate/gate.py` with `llm.client`.
- [ ] **Task 5.2: Model benchmark** (0.25 day)
  - Run `bench_models.py` on the demo laptop with Wi-Fi off. Record the chosen model in `.env`.
- [ ] **Task 5.3: Egress guard** (0.25 day)
  - Implement `privacy/egress.py`. Replace **every** direct `outbox.enqueue` / `INSERT INTO outbox` call outside `sync/` with `egress.enqueue_shareable()`.
- [ ] **Task 5.4: Gate v2: prompts, context, policy** (1 day)
  - Implement the v2 schema with `signals`, `context.neighbours()`, `context.similar_corrections()`, `policy.apply()` and `gate.decide_v2()`.
  - Add a `gate_source` payload index.
- [ ] **Task 5.5: Corrections loop** (0.25 day)
  - The override endpoint writes a `gate_feedback` row (text, dense vector, model verdict, user verdict).
- [ ] **Task 5.6: Async gate worker + finalize()** (0.75 day)
  - Provisional private write, persisted `gate_jobs`, a single worker thread, startup recovery, and promotion with dedup + egress.
- [ ] **Task 5.7: Assistant backend** (1 day)
  - Retrieval, prompt builder, streaming NDJSON `ask()`, citation parsing, sessions, retention sweep, and the "save as memory" endpoint with the taint rule.
- [ ] **Task 5.8: Split & Share** (0.75 day)
  - Sanitizer prompt, grounding check, PII re-scan, gate re-check, suggestions table, and approve/edit/reject endpoints.
- [ ] **Task 5.9: Dashboard** (1 day)
  - Assistant page, Suggestions inbox, LLM status badge, and a GateBadge tooltip showing signals and context.
- [ ] **Task 5.10: Evals + privacy tests** (0.75 day)
  - `eval_gate.py` v2, `eval_assistant.py`, `test_privacy_boundaries.py`, `test_taint.py` and the import-linter contract.
- [ ] **Task 5.11: Demo integration** (0.5 day)
  - Seed notes for Split & Share and assistant questions, add the new rows to the demo script (§10), and add LLM warmup to lifespan.

---

## 6. Data Model Changes

### 6.1 New payload fields on memories (both shards)

| Field | Type | Meaning |
|---|---|---|
| `gate_source` | keyword | Adds `pending` (provisional) and `user_approved` (Split & Share) to the existing `rule` / `llm` / `fallback` / `user`. **Now indexed.** |
| `gate_signals` | list[str] | Signals returned by the LLM, e.g. `["equipment_fix", "part_or_spec"]`. |
| `gate_context` | dict | `{"neighbours": 3, "corrections": 1}`: how much on-device context the decision used (counts only, no text). |
| `gate_flags` | list[str] | Veto reasons, e.g. `["signal_veto"]`, `["neighbour_veto"]`. |

> [!IMPORTANT]
> Shareable payloads **must not** carry any reference to a private memory: no `derived_from` pointing at a private ID, and no private text inside `gate_reason`. The link between a sanitized fact and its private original lives only in the local SQLite table `share_suggestions`.

### 6.2 New SQLite tables

`gate_jobs`, `gate_feedback`, `share_suggestions`, `chat_sessions`, `chat_messages`. See §7.2.

---

## 7. Code Specifications

### 7.1 Settings (`edge/edge/config.py`, additions)

```python
class Settings(BaseSettings):
    # ... existing fields ...

    # Local LLM (Phase 5). `ollama_model` is kept so existing .env files still work.
    llm_host: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:1.5b"
    llm_num_ctx: int = 4096          # SAME value for every call, or Ollama reloads the model
    llm_keep_alive: str = "30m"
    llm_timeout_s: float = 20.0      # HTTP timeout; the gate has its own budget
    gate_mode: str = "async"         # async | sync (sync is used by the eval script)
    gate_context_k: int = 4
    gate_corrections_k: int = 3
    gate_neighbour_min_score: float = 0.55
    assistant_top_k: int = 6
    assistant_context_chars: int = 6000   # ~1500 tokens of notes; leaves room for answer + history
    assistant_history_turns: int = 2
    chat_retention_days: int = 7
```

### 7.2 SQLite additions (`edge/edge/schema.sql`)

```sql
-- Persisted async gate + sanitizer jobs (survive crash/restart)
CREATE TABLE IF NOT EXISTS gate_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('classify', 'sanitize')),
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | inflight | done | failed | cancelled
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gate_jobs_status ON gate_jobs(status, id);

-- Technician corrections: the on-device learning signal. NEVER synced.
CREATE TABLE IF NOT EXISTS gate_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    text TEXT NOT NULL,
    dense_json TEXT NOT NULL,                 -- 384-d vector, for similarity lookup
    model_category TEXT,                      -- what the gate said
    user_category TEXT NOT NULL,              -- what the technician chose
    ts INTEGER NOT NULL
);

-- Split & Share proposals. The private link lives ONLY here.
CREATE TABLE IF NOT EXISTS share_suggestions (
    id TEXT PRIMARY KEY,
    source_memory_id TEXT NOT NULL,           -- private original (local only)
    proposed_text TEXT NOT NULL,
    asset_tag TEXT,
    checks_json TEXT NOT NULL,                -- {"pii": [], "grounding": 0.92, "gate": "shareable"}
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    derived_memory_id TEXT,                   -- shareable memory created on approval
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);

-- Local-only chat. NEVER synced, NEVER exported.
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    scope TEXT NOT NULL DEFAULT 'device',     -- device | fleet
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    sources_json TEXT,                        -- [{"n":1,"memory_id":"...","category":"private"}, ...]
    cited_json TEXT,                          -- memory_ids actually cited
    latency_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chat_messages_session ON chat_messages(session_id, created_at);
```

### 7.3 LLM client (`edge/edge/llm/client.py`)

```python
"""The ONLY module allowed to talk to the language model.

Guarantees:
- The host is loopback, and cloud-hosted model tags are refused (NFR-09).
- One generation at a time (CPU), with a fixed num_ctx so the model never reloads.
"""
import json, threading, time
from urllib.parse import urlparse
from ollama import Client
from edge.config import settings

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


class PrivacyError(RuntimeError):
    pass


def assert_local() -> None:
    host = urlparse(settings.llm_host).hostname
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


def chat_json(messages: list[dict], schema: dict, num_predict: int = 120) -> dict:
    """Deterministic structured call. Raises on invalid JSON; callers fail closed."""
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
    finally:
        _record((time.perf_counter() - t0) * 1000, ok)


def chat_stream(messages: list[dict], num_predict: int = 350):
    """Token stream for the assistant. Holding the slot while streaming is intended.
    If the client disconnects, the generator closes and the lock is released."""
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
```

> Swapping in a model whose Ollama tag supports thinking (e.g. some `qwen3.5` tags): pass `think=False` in both `chat` calls, or the model spends seconds thinking before it answers.

### 7.4 Gate v2 prompts (`edge/edge/gate/prompts.py`)

```python
SIGNALS = [
    "equipment_fault", "equipment_fix", "equipment_setting", "part_or_spec",   # technical
    "person", "customer", "credential", "money", "site_access", "personal",    # sensitive
    "status", "time_keeping",                                                  # noise
]
TECH_SIGNALS = {"equipment_fault", "equipment_fix", "equipment_setting", "part_or_spec"}
PRIVATE_SIGNALS = {"person", "customer", "credential", "money", "site_access", "personal"}

SYSTEM = """You route field-technician notes. Reply with JSON only.
Categories:
- shareable: a reusable technical fact about equipment (fault, cause, fix, part, setting).
- private: mentions a person, customer, site access, credentials, money, or anything personal.
- routine: status or time-keeping with no reusable technical knowledge.
If a note mixes a technical fact with anything private, choose private.
signals: list every signal that appears in the note, from the allowed list.
reason: one short sentence, max 15 words.
You may be shown similar notes and past corrections from this device. Corrections are the
technician's own decisions: follow them when a new note is similar."""

# (text, category, signals, reason). These form the STATIC PREFIX: never reorder them at runtime.
EXAMPLES = [
    ("P-200 cavitation noise fixed by replacing the worn impeller.", "shareable",
     ["equipment_fault", "equipment_fix", "part_or_spec"], "Reusable fix for a known pump fault."),
    ("Torque spec for panel B bus bars is 25 Nm, not 20.", "shareable",
     ["equipment_setting"], "Equipment setting others will need."),
    ("Site manager was rude about the delay, avoid him next visit.", "private",
     ["person", "personal"], "Personal opinion about a person."),
    ("Customer unhappy with last invoice, do not discuss pricing.", "private",
     ["customer", "money"], "Customer relationship and money."),
    ("Replaced seal on P-200; plant head asked me to keep the leak quiet.", "private",
     ["equipment_fix", "person"], "Technical fact mixed with a sensitive request."),
    ("Reached site at 10:15, starting inspection.", "routine",
     ["time_keeping"], "Time-keeping only."),
    ("Checked panel B, everything normal.", "routine",
     ["status"], "Status with no new knowledge."),
]

SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": ["shareable", "private", "routine"]},
        "signals": {"type": "array", "items": {"type": "string", "enum": SIGNALS}},
        "reason": {"type": "string"},
    },
    "required": ["category", "signals", "reason"],
}


def _answer(cat, sig, why) -> str:
    import json
    return json.dumps({"category": cat, "signals": sig, "reason": why})


def _clip(t: str, n: int = 180) -> str:
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 1] + "…"


def messages(note: str, neighbours: list[dict], corrections: list[dict]) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM}]
    for text, cat, sig, why in EXAMPLES:                       # static prefix (cache-friendly)
        msgs.append({"role": "user", "content": text})
        msgs.append({"role": "assistant", "content": _answer(cat, sig, why)})

    parts = []                                                 # dynamic context goes LAST
    if corrections:
        parts.append("Past corrections by this technician:")
        parts += [f'- "{_clip(c["text"])}" -> {c["user_category"]}' for c in corrections]
    if neighbours:
        parts.append("Similar notes already on this device (label, how it was decided):")
        parts += [f'- [{n["category"]}, {n["gate_source"]}] "{_clip(n["text"])}"' for n in neighbours]
    parts.append("NOTE TO CLASSIFY:")
    parts.append(note)
    msgs.append({"role": "user", "content": "\n".join(parts)})
    return msgs
```

### 7.5 On-device context (`edge/edge/gate/context.py`)

```python
import json
import numpy as np
from qdrant_edge import Query, QueryRequest, Filter, FieldCondition, MatchValue
from edge import db
from edge.config import settings
from edge.store.shards import private, shared

_EXCLUDE = [
    FieldCondition(key="deleted", match=MatchValue(value=True)),
    FieldCondition(key="gate_source", match=MatchValue(value="pending")),
]


def neighbours(dense: list[float], exclude_id: str | None = None) -> list[dict]:
    """Top-k similar, already-decided notes from BOTH shards. Local reads only."""
    k = settings.gate_context_k
    hits = []
    for sh in (private, shared):
        with sh.lock:
            hits += sh.shard.query(QueryRequest(
                query=Query.Nearest(dense, using="dense"),
                filter=Filter(must_not=_EXCLUDE),
                limit=k + 1,
                with_payload=True,
                with_vector=False,
            ))
    hits = [h for h in hits
            if str(h.id) != exclude_id and h.score >= settings.gate_neighbour_min_score]
    hits.sort(key=lambda h: h.score, reverse=True)
    return [{"id": str(h.id), "score": round(h.score, 3), **h.payload} for h in hits[:k]]


def similar_corrections(dense: list[float]) -> list[dict]:
    """Most similar technician corrections (small table: brute-force cosine is fine)."""
    rows = db.execute(
        "SELECT text, dense_json, model_category, user_category FROM gate_feedback "
        "ORDER BY ts DESC LIMIT 500"
    ).fetchall()
    if not rows:
        return []
    q = np.asarray(dense, dtype=np.float32)
    q /= np.linalg.norm(q) + 1e-9
    scored = []
    for r in rows:
        v = np.asarray(json.loads(r["dense_json"]), dtype=np.float32)
        s = float(q @ (v / (np.linalg.norm(v) + 1e-9)))
        if s >= 0.60:
            scored.append((s, dict(r)))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[: settings.gate_corrections_k]]
```

### 7.6 Veto policy (`edge/edge/gate/policy.py`)

```python
from edge.gate.prompts import PRIVATE_SIGNALS, TECH_SIGNALS

TRUSTED_SOURCES = {"user", "rule", "user_approved"}


def apply(llm_out: dict, neighbours: list[dict], corrections: list[dict]) -> tuple[str, str, list[str]]:
    """Returns (category, reason, flags). Can DOWNGRADE to private. Never upgrades."""
    cat = llm_out["category"]
    sig = set(llm_out.get("signals", []))
    reason = llm_out.get("reason", "")[:120]

    if cat != "shareable":
        return cat, reason, []

    if sig & PRIVATE_SIGNALS:
        return "private", f"Veto: sensitive signal ({', '.join(sorted(sig & PRIVATE_SIGNALS))})", ["signal_veto"]

    if not sig & TECH_SIGNALS:
        return "private", "Veto: no technical content detected", ["no_tech_veto"]

    # A very similar correction to private is a strong on-device precedent.
    if any(c["user_category"] == "private" for c in corrections[:1]):
        return "private", "Veto: technician kept a very similar note private", ["correction_veto"]

    strong_private = [n for n in neighbours[:3]
                      if n["score"] >= 0.80 and n["category"] == "private"
                      and n["gate_source"] in TRUSTED_SOURCES]
    if len(strong_private) >= 2:
        return "private", "Veto: near-identical notes were kept private", ["neighbour_veto"]

    return "shareable", reason, []
```

### 7.7 Gate v2 pipeline (`edge/edge/gate/gate.py`)

```python
from dataclasses import dataclass, field
from edge.gate import pii, prompts, context, policy
from edge.gate.prompts import TECH_SIGNALS
from edge.llm import client as llm


@dataclass
class GateDecision:
    category: str
    source: str                      # rule | llm | fallback | user | pending | user_approved
    reason: str
    pii_hits: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    context_used: dict = field(default_factory=dict)

    @property
    def sanitize_candidate(self) -> bool:
        return self.category == "private" and bool(set(self.signals) & TECH_SIGNALS)


def rule_check(text: str) -> GateDecision | None:
    hits = pii.scan(text)
    if hits:
        return GateDecision("private", "rule", f"Matched rule: {', '.join(hits)}", pii_hits=hits)
    return None


def decide_v2(text: str, dense: list[float], memory_id: str | None = None) -> GateDecision:
    ruled = rule_check(text)
    if ruled:
        return ruled

    nbrs = context.neighbours(dense, exclude_id=memory_id)
    corr = context.similar_corrections(dense)
    ctx = {"neighbours": len(nbrs), "corrections": len(corr)}

    for _ in range(2):
        try:
            out = llm.chat_json(prompts.messages(text, nbrs, corr), prompts.SCHEMA, num_predict=90)
            if out.get("category") not in ("shareable", "private", "routine"):
                raise ValueError("bad category")
            cat, reason, flags = policy.apply(out, nbrs, corr)
            return GateDecision(cat, "llm", reason, signals=out.get("signals", []),
                                flags=flags, context_used=ctx)
        except Exception:
            continue

    return GateDecision("private", "fallback", "Classifier unavailable; kept local by default",
                        context_used=ctx)
```

### 7.8 Egress guard (`edge/edge/privacy/egress.py`)

```python
"""The single door between this device and the cloud outbox (NFR-10)."""
from edge.gate import pii
from edge.sync import outbox
from edge.events import emit
from edge.llm.client import PrivacyError


def _wire(vectors: dict) -> dict:
    """Same wire format Phase 3 push/cloud expect. Reuse your Phase 3 helper if one exists."""
    sp = vectors["bm25"]
    return {"dense": list(vectors["dense"]),
            "bm25": {"indices": list(sp.indices), "values": list(sp.values)}}


def enqueue_shareable(memory_id: str, vectors: dict, payload: dict,
                      version: int, base_version: int, op: str = "upsert") -> None:
    if payload.get("category") != "shareable":
        emit("privacy.blocked", memory_id, {"why": "non-shareable category"})
        raise PrivacyError("Only shareable memories may be enqueued.")
    hits = pii.scan(f'{payload.get("title", "")} {payload.get("text", "")}')
    if hits and op != "delete":
        emit("privacy.blocked", memory_id, {"why": "pii", "rules": hits})
        raise PrivacyError(f"PII found at egress: {hits}")
    point = {"id": memory_id, "vector": _wire(vectors), "payload": payload}
    outbox.enqueue(memory_id, op, point, version, base_version)
```

> After this task, `grep -rn "outbox.enqueue\|INSERT INTO outbox" edge/edge` must only match `privacy/egress.py` and `sync/outbox.py`. The Phase 2 `create_note` insert and the Task 2.8 retraction tombstone both move to `egress.enqueue_shareable(..., op="delete")`. (Tombstones carry no text, so the PII check is skipped for `delete`.)

### 7.9 Memory service with async gate (`edge/edge/memory/service.py`, key functions)

```python
import time, uuid
from qdrant_edge import Point, UpdateOperation
from edge import db
from edge.config import settings
from edge.events import emit
from edge.store.embed import embed_doc
from edge.store.shards import private, shared, shard_for
from edge.gate import gate as gatemod
from edge.gate import worker as gate_worker
from edge.memory.dedup import find_duplicate
from edge.privacy import egress


def now_ms() -> int:
    return int(time.time() * 1000)


def _base_payload(mid, text, title, asset_tag, d: "gatemod.GateDecision", ts) -> dict:
    return {
        "memory_id": mid, "text": text, "title": title, "asset_tag": asset_tag,
        "category": d.category, "gate_source": d.source, "gate_reason": d.reason,
        "gate_signals": d.signals, "gate_flags": d.flags, "gate_context": d.context_used,
        "pii_hits": d.pii_hits, "device_id": settings.device_id, "author": settings.author,
        "version": 1, "base_version": 0, "created_at": ts, "updated_at": ts,
        "expires_at": None, "deleted": False, "merged_from": [],
        "sync_state": "local_only",
    }


def _upsert(sh, mid, vectors, payload):
    with sh.lock:
        sh.shard.update(UpdateOperation.upsert_points([Point(id=mid, vector=vectors, payload=payload)]))


def _delete(sh, mid):
    # Use the same delete operation your Phase 2 relocate() uses.
    with sh.lock:
        sh.shard.update(UpdateOperation.delete_points([mid]))


def _enqueue_job(mid: str, kind: str):
    db.execute("INSERT INTO gate_jobs(memory_id, kind, created_at) VALUES (?, ?, ?)",
               (mid, kind, now_ms()))
    gate_worker.notify()


def create_note(text: str, title: str = "", asset_tag: str = "") -> dict:
    vectors = embed_doc(text)
    ts, mid = now_ms(), str(uuid.uuid4())
    ruled = gatemod.rule_check(f"{title} {text}")

    if ruled:                                    # instant, final, private
        payload = _base_payload(mid, text, title, asset_tag, ruled, ts)
        _upsert(private, mid, vectors, payload)
        emit("gate.decided", mid, {"category": "private", "source": "rule", "reason": ruled.reason})
        _enqueue_job(mid, "sanitize")            # it may still contain a reusable fix
        return payload

    if settings.gate_mode == "sync":             # eval / fallback mode
        return finalize(mid, text, title, asset_tag, ts, vectors, provisional=False)

    pending = gatemod.GateDecision("private", "pending", "Classifying on device…")
    payload = _base_payload(mid, text, title, asset_tag, pending, ts)
    _upsert(private, mid, vectors, payload)      # searchable immediately, private by default
    emit("memory.created", mid, {"category": "private", "pending": True})
    _enqueue_job(mid, "classify")
    return payload


def finalize(mid, text, title, asset_tag, created_at, vectors=None, provisional=True) -> dict:
    """Run Gate v2 and move the memory to its final home. Called by the worker."""
    vectors = vectors or embed_doc(text)
    d = gatemod.decide_v2(f"{title}\n{text}".strip(), vectors["dense"], memory_id=mid)
    ts = now_ms()

    if d.category == "shareable":
        dup = find_duplicate(shared, vectors["dense"], asset_tag)
        if dup:                                  # merge into the existing shared memory
            cur = dup.payload
            base = cur["version"]
            cur.update(text=text, version=base + 1, base_version=base, updated_at=ts,
                       sync_state="pending")
            cur["merged_from"].append(mid)
            _upsert(shared, str(dup.id), vectors, cur)
            egress.enqueue_shareable(str(dup.id), vectors, cur, cur["version"], base)
            if provisional:
                _delete(private, mid)
            emit("dedup.merged", str(dup.id), {"version": cur["version"]})
            return cur

    payload = _base_payload(mid, text, title, asset_tag, d, created_at)
    payload["updated_at"] = ts
    if d.category == "routine":
        payload["expires_at"] = ts + settings.routine_ttl_days * 86_400_000

    if d.category == "shareable":
        payload["sync_state"] = "pending"
        _upsert(shared, mid, vectors, payload)
        if provisional:
            _delete(private, mid)
        egress.enqueue_shareable(mid, vectors, payload, 1, 0)
    else:
        _upsert(private, mid, vectors, payload)

    emit("gate.decided", mid, {"category": d.category, "source": d.source, "reason": d.reason,
                               "signals": d.signals, "flags": d.flags, "context": d.context_used})
    if d.sanitize_candidate:
        _enqueue_job(mid, "sanitize")
    return payload
```

**Edge cases the worker must handle** (put these in the worker, not the service):
- **The user edits or deletes the note while it is pending.** Before finalizing, re-read the point. If it is gone, `deleted`, or its `updated_at` changed since the job was created, mark the job `cancelled` and enqueue a fresh one if the note still exists.
- **The user overrides the category while it is pending.** The override endpoint sets all of that memory's pending jobs to `cancelled`. The user always wins.
- **The LLM times out.** `decide_v2` returns the `fallback` decision, so the note stays private. Show a "Re-classify" button in the Inspector.

### 7.10 Persisted gate worker (`edge/edge/gate/worker.py`)

```python
import threading, time
from edge import db
from edge.events import emit

_wake = threading.Event()


def notify():
    _wake.set()


def _claim():
    row = db.execute("SELECT * FROM gate_jobs WHERE status='pending' ORDER BY id LIMIT 1").fetchone()
    if row:
        db.execute("UPDATE gate_jobs SET status='inflight', attempts=attempts+1 WHERE id=?", (row["id"],))
    return row


def _run():
    from edge.memory import service          # late import avoids a cycle
    from edge.gate import sanitize
    from edge.store.shards import private, shared
    while True:
        job = _claim()
        if not job:
            _wake.wait(timeout=5)
            _wake.clear()
            continue
        mid = job["memory_id"]
        try:
            sh, rec = service.get(mid)        # Phase 1 get(): (shard, record) or (None, None)
            if rec is None or rec.payload.get("deleted"):
                status = "cancelled"
            elif job["kind"] == "classify":
                p = rec.payload
                if p.get("gate_source") != "pending":
                    status = "cancelled"      # user already decided
                else:
                    service.finalize(mid, p["text"], p.get("title", ""), p.get("asset_tag", ""),
                                     p["created_at"])
                    status = "done"
            else:                             # sanitize
                sanitize.propose(mid, rec.payload)
                status = "done"
        except Exception as e:
            status = "failed"
            emit("gate.error", mid, {"kind": job["kind"], "error": str(e)[:200]})
        db.execute("UPDATE gate_jobs SET status=? WHERE id=?", (status, job["id"]))


def start():
    db.execute("UPDATE gate_jobs SET status='pending' WHERE status='inflight'")   # crash recovery
    threading.Thread(target=_run, name="gate-worker", daemon=True).start()
```

### 7.11 Split & Share sanitizer (`edge/edge/gate/sanitize.py`)

```python
import re, time, uuid, json
from edge import db
from edge.events import emit
from edge.gate import pii
from edge.gate import gate as gatemod
from edge.llm import client as llm
from edge.store.embed import embed_doc

SYSTEM = """Rewrite a private field note as ONE short sentence another technician could reuse.
Keep ONLY equipment facts: fault, cause, fix, part, setting, measurement, asset tag.
Remove every person, name, customer, site, code, password, money amount, opinion and request.
Never add a fact that is not in the note. If there is no reusable equipment fact, return "".
Reply as JSON: {"fact": "..."}"""
SCHEMA = {"type": "object", "properties": {"fact": {"type": "string"}}, "required": ["fact"]}

_WORD = re.compile(r"[a-z0-9][a-z0-9\-\.]*", re.I)
_STOP = {"the", "and", "was", "were", "with", "for", "from", "that", "this", "after", "then",
         "has", "have", "had", "its", "into", "when", "on", "of", "to", "a", "an", "is", "by"}


def _tokens(t: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(t) if len(w) >= 3 and w.lower() not in _STOP}


def grounding(fact: str, original: str) -> float:
    """Share of the fact's content words that appear in the original (1.0 = fully grounded)."""
    f, o = _tokens(fact), _tokens(original)
    return 1.0 if not f else len(f & o) / len(f)


def _numbers_preserved(fact: str, original: str) -> bool:
    nums = re.findall(r"\d+(?:\.\d+)?", fact)
    return all(n in original for n in nums)      # no invented values or part numbers


def propose(memory_id: str, payload: dict) -> str | None:
    original = payload["text"]
    out = llm.chat_json(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": original}],
        SCHEMA, num_predict=80,
    )
    fact = " ".join(out.get("fact", "").split())
    if len(fact) < 12:
        return None

    checks = {
        "pii": pii.scan(fact),
        "grounding": round(grounding(fact, original), 2),
        "numbers_preserved": _numbers_preserved(fact, original),
    }
    ok = not checks["pii"] and checks["grounding"] >= 0.75 and checks["numbers_preserved"]
    if ok:
        d = gatemod.decide_v2(fact, embed_doc(fact)["dense"])  # the rewrite must pass the gate too
        checks["gate"] = d.category
        ok = d.category == "shareable"
    if not ok:
        emit("share.rejected_auto", memory_id, {"checks": checks})
        return None

    sid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO share_suggestions(id, source_memory_id, proposed_text, asset_tag, checks_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (sid, memory_id, fact, payload.get("asset_tag", ""), json.dumps(checks), int(time.time() * 1000)),
    )
    emit("share.suggested", memory_id, {"suggestion_id": sid})   # no text in the event
    return sid
```

**Approval flow (`api/suggestions.py`)**
- `GET /suggestions?status=pending` lists suggestions. The UI shows the proposed text and the checks. The private original is shown **redacted** (PII spans masked) with a "reveal" toggle.
- `POST /suggestions/{id}/approve` takes an optional body `{"text": "edited version"}`. It re-runs the PII scan and grounding on any edited text, then creates a **new** memory with `category="shareable"`, `gate_source="user_approved"`, `gate_reason="Sanitized from a private note, approved by technician"`. The memory goes through `egress.enqueue_shareable()`. The endpoint stores `derived_memory_id` in the suggestions table only.
- `POST /suggestions/{id}/reject` marks the suggestion rejected. A rejection is also a learning signal: store it as a `gate_feedback` row with `user_category="private"`.

### 7.12 Corrections loop (update to `POST /memories/{id}/category`)

```python
# after the existing relocate logic succeeds:
db.execute(
    "INSERT INTO gate_feedback(memory_id, text, dense_json, model_category, user_category, ts) "
    "VALUES (?, ?, ?, ?, ?, ?)",
    (mid, payload["text"], json.dumps(embed_doc(payload["text"])["dense"]),
     old_category if old_source in ("llm", "fallback") else None, new_category, now_ms()),
)
db.execute("UPDATE gate_jobs SET status='cancelled' WHERE memory_id=? AND status='pending'", (mid,))
emit("gate.corrected", mid, {"from": old_category, "to": new_category})
```

### 7.13 Assistant retrieval (`edge/edge/assistant/retrieve.py`)

```python
import re, time
from edge.config import settings
from edge.store.search import search

ASSET_TAG = re.compile(r"\b[A-Z]{1,10}-\d{1,4}[A-Z]?\b")


def retrieve(question: str, scope: str = "device", prev_question: str | None = None) -> dict:
    """Hybrid RRF retrieval across private + shared (device) or shared only (fleet)."""
    q = question
    if prev_question and len(question.split()) <= 6:     # cheap follow-up handling
        q = f"{prev_question} {question}"

    k = settings.assistant_top_k
    flt = {"category": "shareable"} if scope == "fleet" else {}
    tag_match = ASSET_TAG.search(q.upper())

    t0 = time.perf_counter()
    results = []
    if tag_match:
        results = search(q, mode="hybrid", limit=k, asset_tag=tag_match.group(0), **flt)["results"]
    if len(results) < k:                                   # top up without the tag filter
        seen = {r["id"] for r in results}
        more = search(q, mode="hybrid", limit=k, **flt)["results"]
        results += [r for r in more if r["id"] not in seen]

    now = int(time.time() * 1000)
    results = [r for r in results
               if not (r.get("expires_at") and r["expires_at"] < now)      # expired routine
               and r.get("gate_source") != "pending"][:k]                 # unfinished gate
    return {"results": results, "ms": round((time.perf_counter() - t0) * 1000, 1)}
```

> Why include `pending` exclusion: a note still being classified is private by default, but its final shape (merged/deduped) is not settled; excluding it avoids citing a point that may disappear seconds later.

### 7.14 Assistant prompts (`edge/edge/assistant/prompts.py`)

```python
from datetime import datetime
from edge.config import settings

SYSTEM = """You are EdgeVault, an offline assistant for field technicians. You run entirely on this device.
Answer ONLY using the numbered notes provided. After each fact you use, add its note number in
square brackets, like [2]. Copy exact values (codes, part numbers, torque, pressure, temperature)
exactly as written. If the notes do not contain the answer, reply exactly:
"I don't have that in this device's memory." Do not guess. Keep answers under 5 short sentences."""

LABEL = {"shareable": "FLEET", "private": "PRIVATE", "routine": "ROUTINE"}


def _origin(r: dict) -> str:
    return "this device" if r.get("device_id") == settings.device_id else f"from {r.get('device_id')}"


def context_block(results: list[dict]) -> tuple[str, list[dict]]:
    lines, sources, used = [], [], 0
    for i, r in enumerate(results, start=1):
        date = datetime.fromtimestamp(r.get("updated_at", 0) / 1000).strftime("%Y-%m-%d")
        tag = f" · {r['asset_tag']}" if r.get("asset_tag") else ""
        head = f"[{i}] ({LABEL.get(r.get('category'), '?')} · {_origin(r)} · {date}{tag})"
        body = " ".join(f"{r.get('title', '')}: {r.get('text', '')}".split())
        line = f"{head} {body}"
        if used + len(line) > settings.assistant_context_chars:
            break
        lines.append(line)
        used += len(line)
        sources.append({"n": i, "memory_id": r["id"], "category": r.get("category"),
                        "title": r.get("title"), "asset_tag": r.get("asset_tag"),
                        "origin": _origin(r), "score": r.get("score")})
    return "\n".join(lines), sources


def build(question: str, results: list[dict], history: list[dict]) -> tuple[list[dict], list[dict]]:
    block, sources = context_block(results)
    msgs = [{"role": "system", "content": SYSTEM}]
    for h in history[-2 * settings.assistant_history_turns:]:
        msgs.append({"role": h["role"], "content": h["content"]})
    notes = block if block else "(no notes found)"
    msgs.append({"role": "user", "content": f"NOTES:\n{notes}\n\nQUESTION: {question}"})
    return msgs, sources
```

### 7.15 Assistant service (`edge/edge/assistant/service.py`)

```python
import re, time, uuid, json
from edge.assistant import retrieve as R, prompts as P, sessions as S
from edge.events import emit
from edge.llm import client as llm

CITE = re.compile(r"\[(\d{1,2})\]")
REFUSAL = "I don't have that in this device's memory."


def ask(session_id: str | None, question: str, scope: str = "device"):
    """Generator of NDJSON-ready events: sources -> token* -> done."""
    t0 = time.perf_counter()
    session_id = session_id or S.create(title=question[:60], scope=scope)
    history = S.history(session_id)
    prev_q = next((h["content"] for h in reversed(history) if h["role"] == "user"), None)

    got = R.retrieve(question, scope=scope, prev_question=prev_q)
    msgs, sources = P.build(question, got["results"], history)
    yield {"type": "sources", "session_id": session_id, "sources": sources, "retrieve_ms": got["ms"]}

    answer, first_token_ms = [], None
    if not sources:
        answer.append(REFUSAL)
        yield {"type": "token", "text": REFUSAL}
    else:
        try:
            for piece in llm.chat_stream(msgs):
                if first_token_ms is None:
                    first_token_ms = round((time.perf_counter() - t0) * 1000, 1)
                answer.append(piece)
                yield {"type": "token", "text": piece}
        except Exception:
            msg = "The on-device model is not responding. Your notes are still searchable in Search."
            answer.append(msg)
            yield {"type": "token", "text": msg}

    text = "".join(answer).strip()
    valid = {s["n"]: s for s in sources}
    cited_ns = sorted({int(n) for n in CITE.findall(text) if int(n) in valid})
    cited = [valid[n]["memory_id"] for n in cited_ns]
    grounded = bool(cited) or text.startswith("I don't have")
    latency = {"retrieve": got["ms"], "first_token": first_token_ms,
               "total": round((time.perf_counter() - t0) * 1000, 1)}

    S.add(session_id, "user", question)
    msg_id = S.add(session_id, "assistant", text, sources=sources, cited=cited, latency=latency)

    # Event carries counts only, never the question or answer text.
    emit("assistant.answered", None, {"sources": len(sources), "cited": len(cited),
                                      "grounded": grounded, "latency": latency, "scope": scope})
    yield {"type": "done", "message_id": msg_id, "cited_ns": cited_ns, "cited": cited,
           "grounded": grounded, "latency_ms": latency}
```

### 7.16 Chat storage (`edge/edge/assistant/sessions.py`)

```python
import json, time, uuid
from edge import db
from edge.config import settings


def _now():
    return int(time.time() * 1000)


def create(title: str, scope: str) -> str:
    sid = str(uuid.uuid4())
    db.execute("INSERT INTO chat_sessions(id, title, scope, created_at, updated_at) VALUES (?,?,?,?,?)",
               (sid, title, scope, _now(), _now()))
    return sid


def add(session_id, role, content, sources=None, cited=None, latency=None) -> str:
    mid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO chat_messages(id, session_id, role, content, sources_json, cited_json, latency_json, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (mid, session_id, role, content, json.dumps(sources), json.dumps(cited), json.dumps(latency), _now()),
    )
    db.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?", (_now(), session_id))
    return mid


def history(session_id: str) -> list[dict]:
    rows = db.execute("SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at",
                      (session_id,)).fetchall()
    return [dict(r) for r in rows]


def sweep():
    """Retention: called by the existing TTL sweeper every 10 minutes."""
    cutoff = _now() - settings.chat_retention_days * 86_400_000
    old = [r[0] for r in db.execute("SELECT id FROM chat_sessions WHERE updated_at < ?", (cutoff,)).fetchall()]
    for sid in old:
        db.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
        db.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
```

### 7.17 Taint rule (`edge/edge/memory/taint.py`)

```python
RESTRICTIVENESS = {"shareable": 0, "routine": 1, "private": 2}


def inherited_floor(source_categories: list[str]) -> str:
    """The least-restrictive category a derived memory may have."""
    if not source_categories:
        return "shareable"
    worst = max(source_categories, key=lambda c: RESTRICTIVENESS.get(c, 2))
    return "private" if worst in ("private", "routine") else "shareable"
```

**Save answer as memory** (`POST /assistant/messages/{id}/save`):
1. Load the message and the categories of its **cited** sources (fall back to all sources if nothing was cited).
2. `floor = inherited_floor(categories)`.
3. If `floor == "private"`, write directly to the private shard with `gate_source="rule"` and `gate_reason="Derived from private notes (taint)"`.
4. Otherwise, call `create_note()` normally. The gate and the PII scan still run, because the technician's question may have added private details to the answer.

### 7.18 API routers

```python
# edge/edge/api/assistant.py
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from edge.assistant import service, sessions

router = APIRouter(prefix="/assistant")


class AskBody(BaseModel):
    question: str
    session_id: str | None = None
    scope: str = "device"          # device | fleet


@router.post("/ask")
def ask(body: AskBody):
    if not body.question.strip():
        raise HTTPException(400, "empty question")
    gen = (json.dumps(ev) + "\n" for ev in service.ask(body.session_id, body.question, body.scope))
    return StreamingResponse(gen, media_type="application/x-ndjson")   # sync generator -> threadpool


@router.get("/sessions")
def list_sessions():
    from edge import db
    return [dict(r) for r in db.execute(
        "SELECT id, title, scope, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50")]


@router.delete("/sessions/{sid}")
def delete_session(sid: str):
    from edge import db
    db.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
    db.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
    return {"deleted": sid}
```

```python
# edge/edge/api/llm.py
from fastapi import APIRouter
from edge.config import settings
from edge.llm import client as llm
from edge import db

router = APIRouter(prefix="/llm")


@router.get("/status")
def status():
    pending = db.execute("SELECT COUNT(*) FROM gate_jobs WHERE status IN ('pending','inflight')").fetchone()[0]
    return {"model": settings.ollama_model, "host": settings.llm_host, "loaded": llm.loaded_models(),
            "stats": llm.stats(), "gate_queue": pending, "gate_mode": settings.gate_mode}
```

Register both routers, plus `suggestions.router`, in `main.py`.

### 7.19 Lifespan updates (`edge/edge/main.py`)

```python
from edge.llm import client as llm
from edge.gate import worker as gate_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    events.bind_loop(asyncio.get_running_loop())
    embed.embed_query("warm up query")
    llm.warmup()                    # loads the model into RAM (replaces gate.decide warmup)
    gate_worker.start()             # recovers inflight jobs, starts the worker thread
    task = asyncio.create_task(worker.run())
    yield
    task.cancel()
    shards.private.shard.close()
    shards.shared.shard.close()
```

Also add `"gate_source": PayloadSchemaType.Keyword` to `INDEXES` in `shards.py`. Existing shards were created without that index, so create it once at startup inside a `try/except`.

### 7.20 Architectural contract (`.importlinter`)

```ini
[importlinter]
root_package = edge

[importlinter:contract:sync-cannot-see-private-intelligence]
name = Sync layer cannot import assistant, chat, gate context or the LLM
type = forbidden
source_modules =
    edge.sync
forbidden_modules =
    edge.assistant
    edge.gate.context
    edge.gate.sanitize
    edge.llm
```

Run it with `uv run lint-imports`. Import rules can't express "sync never reads the private shard object", so `test_privacy_boundaries.py` also checks that the source of `edge/sync/*.py` never references `shards.private` or `from edge.store.shards import private`.

---

## 8. Dashboard Additions

### 8.1 NDJSON stream reader (`dashboard/lib/stream.ts`)

```typescript
export type AskEvent =
  | { type: "sources"; session_id: string; sources: Source[]; retrieve_ms: number }
  | { type: "token"; text: string }
  | { type: "done"; message_id: string; cited_ns: number[]; cited: string[];
      grounded: boolean; latency_ms: { retrieve: number; first_token: number | null; total: number } };

export type Source = { n: number; memory_id: string; category: "shareable" | "private" | "routine";
  title?: string; asset_tag?: string; origin: string; score?: number };

export async function* askStream(base: string, body: { question: string; session_id?: string; scope?: string }) {
  const res = await fetch(`${base}/assistant/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`ask failed: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as AskEvent;
    }
  }
}
```

### 8.2 Assistant page (`dashboard/app/assistant/page.tsx`): required behaviour

- A scope switch at the top: **This device (private + fleet)** / **Fleet only**.
- A pinned banner: `On-device · <model> · works offline · chats stay on this device`. The model name comes from `GET /llm/status`. Don't claim byte counts you don't measure.
- Answer text streams token by token. Each `[n]` is rendered as a `CitationChip` with the category label as **text** (`PRIVATE`, `FLEET · device-b`, `ROUTINE`), following your Phase 4 rule of never relying on colour alone. Clicking a chip opens that memory in the Inspector.
- A "Sources" drawer lists **all** retrieved notes, dimming those that weren't cited.
- A footer per answer shows latency (`retrieve 12 ms · first token 1.4 s · total 6.8 s`) and an **"Ungrounded"** warning if `grounded` is false.
- A **Save as memory** button. On success, show the resulting category and reason, e.g. `PRIVATE: derived from private notes (taint)`.
- **Delete chat** per session.

### 8.3 Share Suggestions inbox (`dashboard/app/suggestions/page.tsx`)

- Layout is two columns. Left: the private original with PII spans masked (`████`) and a reveal toggle. Right: the proposed fact in an editable textarea.
- The check results appear as text badges, for example `PII: none ✓`, `Grounding: 0.92 ✓`, `Numbers preserved ✓`, `Gate: shareable ✓`.
- Buttons: **Share to fleet**, **Edit & share**, **Keep private**.
- Show a badge count in the nav, updated from the SSE events `share.suggested` / `share.approved`.

### 8.4 Top bar and GateBadge

- `LlmStatus.tsx` polls `/llm/status` every 5 s and shows `qwen2.5:1.5b · loaded · p95 1.2 s · queue 0`, or an amber `Model offline: notes kept private`.
- The `GateBadge` tooltip adds: signals, the veto flag if any, and `Used 3 similar notes, 1 correction`. For `pending`, show `Classifying on device…` with a spinner; the SSE `gate.decided` event updates it live.

---

## 9. Evaluation & Exit Criteria

### 9.1 Gate eval set (`tests/gate_eval_v2.jsonl`), 40 items

| Slice | Count | Purpose |
|---|---|---|
| Clean shareable fixes | 10 | Recall on real knowledge |
| Clearly private (person, customer, money, access) | 8 | Must never leak |
| Routine / status | 7 | TTL routing |
| **Mixed** (fix + private detail) | 10 | Must be `private`; ≥ 7 of 10 should produce a valid Split & Share suggestion |
| **Correction-dependent** (resembles an earlier override) | 5 | Proves on-device learning: run once *with* the seeded corrections and once without |

Line format: `{"text": "...", "label": "private", "mixed": true, "expect_suggestion": true}`

### 9.2 Model benchmark (`edge/scripts/bench_models.py`)

```python
"""Usage: uv run python edge/scripts/bench_models.py qwen2.5:1.5b gemma3:1b llama3.2:1b"""
import json, sys, time, statistics, os

def run(model: str) -> dict:
    os.environ["OLLAMA_MODEL"] = model
    import importlib
    from edge import config
    importlib.reload(config)
    from edge.llm import client as llm
    importlib.reload(llm)
    from edge.gate import gate
    importlib.reload(gate)
    from edge.store.embed import embed_doc

    llm.warmup()
    items = [json.loads(l) for l in open("edge/tests/gate_eval_v2.jsonl", encoding="utf-8")]
    runs, lat = [], []
    for _ in range(5):
        preds = []
        for it in items:
            t0 = time.perf_counter()
            d = gate.decide_v2(it["text"], embed_doc(it["text"])["dense"])
            lat.append((time.perf_counter() - t0) * 1000)
            preds.append(d.category)
        runs.append(preds)
    labels = [it["label"] for it in items]
    acc = statistics.mean(p == l for p, l in zip(runs[0], labels))
    false_share = sum(p == "shareable" and l != "shareable" for p, l in zip(runs[0], labels))
    flips = sum(len({r[i] for r in runs}) > 1 for i in range(len(items)))
    lat.sort()
    return {"model": model, "accuracy": round(acc, 3), "false_shareables": false_share,
            "flips": flips, "p50_ms": round(lat[len(lat) // 2]), "p95_ms": round(lat[int(len(lat) * .95) - 1]),
            "loaded": llm.loaded_models()}

if __name__ == "__main__":
    for m in sys.argv[1:]:
        print(json.dumps(run(m)))
```

> Run the benchmark on a **fresh device data dir** with no seeded neighbours for the baseline. Then run it again after seeding the demo notes and 5 corrections, to measure the context effect. Put both numbers in your pitch deck: "Gate accuracy X% → Y% with on-device context."

### 9.3 Assistant eval (`tests/assistant_eval.jsonl` + `eval_assistant.py`)

- **15 answerable questions**, each with `expect_titles` (demo note titles). For example, `{"q": "how did we fix the turbine 4 overheat?", "expect_titles": ["Turbine 4 Bearing Overheat Fix"]}`.
- **5 unanswerable questions**, e.g. "What is the warranty period of pump P-900?"
- Metrics:
  - `retrieval_hit@6` ≥ 0.9: an expected note is among the retrieved sources.
  - `citation_validity` = 1.0: every `[n]` maps to a real source. This is enforced in code, so measure that it holds.
  - `citation_recall` ≥ 0.8: the expected note is actually cited.
  - `refusal_rate_unanswerable` ≥ 0.8: the answer starts with "I don't have".
  - `exact_value_fidelity` = 1.0 on 5 questions whose answers contain numbers (torque, PSI, temperature). Every number in the answer must appear in a cited note.

### 9.4 Privacy boundary tests (`tests/test_privacy_boundaries.py`)

```python
import pathlib, pytest

def test_llm_refuses_remote_host(monkeypatch):
    monkeypatch.setenv("LLM_HOST", "http://10.0.0.5:11434")
    import importlib, edge.config as c
    importlib.reload(c)
    import edge.llm.client as client
    with pytest.raises(client.PrivacyError):
        importlib.reload(client)

def test_egress_blocks_private():
    from edge.privacy import egress
    from edge.llm.client import PrivacyError
    with pytest.raises(PrivacyError):
        egress.enqueue_shareable("x", {"dense": [0.0], "bm25": type("S", (), {"indices": [], "values": []})()},
                                 {"category": "private", "text": "hello"}, 1, 0)

def test_egress_blocks_pii_in_shareable():
    from edge.privacy import egress
    from edge.llm.client import PrivacyError
    with pytest.raises(PrivacyError):
        egress.enqueue_shareable("x", {"dense": [0.0], "bm25": type("S", (), {"indices": [], "values": []})()},
                                 {"category": "shareable", "text": "gate code is 4431"}, 1, 0)

def test_only_egress_writes_outbox():
    root = pathlib.Path("edge/edge")
    offenders = [p for p in root.rglob("*.py")
                 if p.parts[-2:] not in (("privacy", "egress.py"), ("sync", "outbox.py"))
                 and ("outbox.enqueue" in p.read_text(encoding="utf-8")
                      or "INSERT INTO outbox" in p.read_text(encoding="utf-8"))]
    assert offenders == [], offenders

def test_sync_never_touches_private_shard():
    for p in pathlib.Path("edge/edge/sync").glob("*.py"):
        src = p.read_text(encoding="utf-8")
        assert "shards.private" not in src and "import private" not in src, p

@pytest.mark.enable_socket
def test_assistant_runs_with_only_loopback(socket_enabled):
    """Run with: pytest --allow-hosts=127.0.0.1,localhost (pytest-socket)."""
    from edge.assistant import service
    events = list(service.ask(None, "how was the turbine bearing overheat fixed?"))
    assert events[0]["type"] == "sources" and events[-1]["type"] == "done"
```

Add `pytest-socket` to dev dependencies. Run the suite with `uv run pytest edge/tests --allow-hosts=127.0.0.1,localhost`. Any attempt by the edge process to reach a non-loopback host fails the test.

### 9.5 End-to-end exit test (PowerShell, Wi-Fi physically OFF for steps 1–5)

```powershell
# 1. Mixed note -> private + suggestion
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "Gate code for Noida plant is 4431. P-200 seal leak fixed by replacing the lip seal with a Viton seal.", "title": "P-200 seal + gate", "asset_tag": "P-200"}'
# Expect: category private, gate_source rule, pii_hits ["access_code"]
Start-Sleep 5
Invoke-RestMethod "http://localhost:7001/suggestions?status=pending"
# Expect: one suggestion like "P-200 seal leak fixed by replacing the lip seal with a Viton seal." with checks all passing

# 2. Ambiguous note -> provisional private, then promoted
Invoke-RestMethod -Method Post -Uri "http://localhost:7001/memories" -ContentType "application/json" -Body '{"text": "C-14 compressor trips on high temp when intake filter clogs; cleaning the filter fixed it.", "asset_tag": "C-14"}'
# Expect immediately: gate_source "pending". Within ~3 s the SSE shows gate.decided -> shareable, outbox +1 (queued while offline)

# 3. Assistant over private + shared, streamed
curl.exe -N -X POST http://localhost:7001/assistant/ask -H "Content-Type: application/json" -d "{\"question\": \"What is the Noida gate code and how do I fix a P-200 seal leak?\"}"
# Expect: answer contains 4431 and Viton with [n] citations; one PRIVATE source

# 4. Save the answer -> taint forces private
#    POST /assistant/messages/<message_id>/save  -> category "private", reason "Derived from private notes (taint)"

# 5. Correction loop
#    Override a shareable LLM decision to private, then add a near-identical note -> expect correction_veto

# 6. Wi-Fi ON: approve the suggestion, let sync run, then:
Invoke-RestMethod http://localhost:8080/stats
# MUST return private_on_server = 0 and routine_on_server = 0
# Device B: search "P-200 seal leak" -> finds the sanitized fact (origin device-a), never the gate code
```

---

## 10. Demo Script Additions (fits the Phase 4 3-minute slot)

Replace the Phase 4 rows at **0:25–0:55** with these, and add the assistant moment after the sync hero moment:

| Elapsed | Screen | Presenter action | What judges see |
|---|---|---|---|
| 0:25 | Device A (offline) | Add the mixed note *"Gate code for Noida plant is 4431. P-200 seal leak fixed by replacing the lip seal with a Viton seal."* | `PRIVATE · Rule: access_code`. Seconds later a **Share suggestion** badge appears. |
| 0:40 | Suggestions inbox | Show the masked original next to the proposed fact and the checks, then click **Share to fleet** | The sanitized fact becomes `SHAREABLE · user approved`. Outbox = 1. The code never left the private shard. |
| 0:55 | Device A | Add *"Reached site at 10:15"* | `ROUTINE`, TTL 14d (unchanged from Phase 4) |
| … | … | *(Phase 4 rows continue: search, sync, conflict)* | … |
| 2:10 | Device B | Search "P-200 seal leak" | The fleet fact from device-a appears. Search "Noida" finds nothing on B. |
| **2:20** | Device A (offline again) | Ask EdgeVault: *"What's the Noida gate code, and how do I fix a P-200 seal leak?"* | A streamed answer with `4431 [1 · PRIVATE]` and `Viton seal [2 · FLEET]`. The banner reads *On-device · works offline*. |
| 2:35 | Device A | Click **Save as memory** | `PRIVATE: derived from private notes (taint)` |
| 2:50 | Cloud stats | `GET /stats` | `private_on_server = 0`, `routine_on_server = 0` |

**Pitch line:** *"The same small model that reads everything on this device decides what may leave it, and it can only ever make data more private. The fleet gets the fix; the gate code never moves."*

---

## 11. Risks, Mitigations & Cut Line

| Risk | Likelihood | Mitigation |
|---|---|---|
| CPU latency too high for the gate with context | Medium | Async gate (5E) takes latency off the write path. Static prompt prefix. Trim `gate_context_k` to 2. Switch to `gemma3:1b`. |
| The assistant answer is slow on stage | Medium | Warm the model at startup. `num_predict=350`. Show the first token fast (streaming). Pre-run the demo question once before judges arrive. |
| The small model invents values | Medium | Refusal instruction, the exact-value fidelity eval, citation chips, and an "Ungrounded" warning. The Split & Share number check blocks invented numbers from ever syncing. |
| The model is misconfigured to a remote or cloud host | Low | The loopback + cloud-tag guard refuses to boot. |
| Two edge nodes on one laptop contend for one Ollama | High in the demo | `OLLAMA_NUM_PARALLEL=1` queues requests. Stagger actions in the script. The gate is async anyway. |
| The demo laptop has ≤ 8 GB RAM | Medium | Use `gemma3:1b` (~0.8 GB) and `OLLAMA_MAX_LOADED_MODELS=1`. Close the browser tabs you don't need. |
| Chat logs accumulate private data | — | Retention sweep, per-session delete, and chat tables excluded from sync by test. |

**Cut line (drop from the bottom first):**
1. ~~Fleet-only scope switch (FR-27)~~
2. ~~Correction-dependent eval slice~~ (keep the corrections loop itself)
3. ~~Async gate (5E)~~: fall back to `gate_mode="sync"` with a 6 s budget. Rules and fail-closed still hold.
4. **Never cut:** the egress guard, the loopback guard, the assistant with citations, Split & Share with human approval, and `/stats = 0`.

---

## 12. Readiness Checklist (Phase 5 done)

- [ ] `bench_models.py` results recorded. The chosen model has **0 false shareables** and **0 flips** across 5 runs.
- [ ] Gate v2 accuracy ≥ 90% on the 40-item set. The accuracy delta with vs. without on-device context is recorded for the pitch.
- [ ] Every `gate_source` value in the Inspector is explainable: `rule`, `llm`, `fallback`, `user`, `pending`, `user_approved`.
- [ ] A mixed note produces a suggestion that passes the PII, grounding, numbers and gate checks, and syncs only after approval.
- [ ] The assistant answers with valid citations, refuses on unanswerable questions, and meets the latency targets on the demo laptop.
- [ ] Saving an answer built from a private source produces a private memory.
- [ ] `lint-imports` passes. `pytest --allow-hosts=127.0.0.1,localhost` passes.
- [ ] The end-to-end test (§9.5) passes with Wi-Fi physically off for steps 1–5.
- [ ] `GET /stats` returns `private_on_server = 0` after the full demo, 5 runs in a row.
