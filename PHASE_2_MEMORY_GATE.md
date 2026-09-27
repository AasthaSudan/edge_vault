# Phase 2: AI Memory Gate & Evolving Memory (1–3 Oct)

> **Timeline:** 1–3 Oct  
> **Goal:** Every write is classified and routed; duplicates merge automatically.  
> **Exit Criterion:** 20-item test set classified with **$\ge$ 90% accuracy**, stable across 5 runs (**zero category flips**, **zero private notes predicted as shareable**).  
> **Milestone:** This is the core build demonstrated in the **3 Oct online round**.

---

## 1. Requirements Covered

| ID | Type | Description | Priority |
|---|---|---|---|
| **FR-07** | Functional | Classify each new memory into `shareable`, `private`, or `routine`, with a one-line reason. | Must |
| **FR-08** | Functional | Deterministic PII pre-filter that forces `private` and cannot be overridden by the LLM. | Must |
| **FR-09** | Functional | User can override the gate decision per memory (moves it between shards). | Must |
| **FR-10** | Functional | Near-duplicate detection on write: merge or update instead of inserting a copy. | Must |
| **FR-11** | Functional | Routine memories expire after a TTL (default 14 days, swept every 10 min). | Should |
| **NFR-02** | Non-Functional | Gate classification latency < 1.5 s per memory on laptop CPU. | Target |
| **NFR-08** | Non-Functional | Explainability: every gate decision and conflict resolution is logged with a human-readable reason. | Target |

---

## 2. Directory & File Structure (Phase 2 Additions)

```
edge/
├── edge/
│   ├── db.py                       # SQLite persistence: outbox, events, conflicts, settings
│   ├── schema.sql                  # DDL definitions
│   ├── events.py                   # Event emitter & SSE subscriber registry
│   ├── gate/
│   │   ├── __init__.py
│   │   ├── pii.py                  # Deterministic regex scanner
│   │   ├── prompts.py              # Few-shot prompts & JSON schema
│   │   ├── classifier.py           # Ollama client (gemma3:1b)
│   │   └── gate.py                 # Decision pipeline: Rules -> LLM -> Fail-Closed Fallback
│   └── memory/
│       ├── dedup.py                # Cosine similarity duplicate detector (threshold 0.92)
│       ├── ttl.py                  # Routine memory background sweep
│       └── service.py              # Updated create flow & shard relocation
└── tests/
    ├── gate_eval.jsonl             # 20+ ground-truth labeled maintenance notes
    └── eval_gate.py                # 5-run accuracy, confusion matrix & flip-check script
```

---

## 3. Gate Classification Taxonomy

| Category | Storage Target | Syncs to Fleet? | Rule of Thumb | Example |
|---|---|---|---|---|
| **`shareable`** | `shared` shard + outbox | **Yes** | A reusable technical fact another tech could apply to the same equipment model. | *"P-200 cavitation noise fixed by replacing the worn impeller"* |
| **`private`** | `private` shard | **Never** | Mentions a person, access credentials, money/pricing, or customer opinions. | *"Gate code for the Noida plant is 4431"* |
| **`routine`** | `private` shard (TTL 14d) | **Never** | Ephemeral status noise or time-keeping with no reusable technical knowledge. | *"Reached site at 10:15, starting inspection"* |

> [!CAUTION]
> **Fail-Closed Principle:** If the LLM times out, errors, or returns invalid JSON, the memory **MUST default to `private`** with `gate_source = "fallback"`. A false private costs nothing; an accidental false shareable leaks sensitive customer or facility data.

---

## 4. Step-by-Step Implementation Tasks

- [ ] **Task 2.1: SQLite Database Foundation (`edge/db.py` & `edge/schema.sql`)**
  - Implement WAL-mode SQLite database at `edge/data/<device_id>/edge.db`.
  - Create tables: `outbox`, `events`, `conflicts`, `settings`.

- [ ] **Task 2.2: Event Bus (`edge/events.py`)**
  - Thread-safe `emit(type, memory_id, data)` logging to the `events` table and broadcasting to active async queues for SSE streaming.

- [ ] **Task 2.3: Deterministic PII Pre-filter (`edge/gate/pii.py`)**
  - Strict regex rules for: `phone`, `email`, `access_code`, `password`, `id_number`, `money`, `address`.
  - Runs before any model call. If triggered, immediately routes to `private`.

- [ ] **Task 2.4: Ollama Local Classification Engine (`edge/gate/classifier.py` & `prompts.py`)**
  - Target model: `ollama run gemma3:1b` (fallback: `qwen2.5:1.5b`).
  - Strict JSON schema enforcement (`{"category": "...", "reason": "..."}`).
  - Timeout: 4 seconds, 1 retry, temperature: 0.

- [ ] **Task 2.5: AI Memory Gate Controller (`edge/gate/gate.py`)**
  - Pipeline: `PII Rules -> Ollama LLM -> Fail-Closed Private Fallback`.
  - Returns structured `GateDecision(category, source, reason, pii_hits)`.

- [ ] **Task 2.6: Near-Duplicate Detection & Merging (`edge/memory/dedup.py`)**
  - Before writing, query the target shard using the dense vector and `asset_tag` filter.
  - If similarity $\ge 0.92$, merge into the existing memory:
    - Update text, increment `version = version + 1`, append ID to `merged_from`, emit `dedup.merged`.

- [ ] **Task 2.7: Routine Memory TTL Expiration (`edge/memory/ttl.py`)**
  - Routine notes receive `expires_at = now + 14 days`.
  - Scheduled sweep every 10 minutes deletes expired notes from `private` shard and emits `ttl.expired`.

- [ ] **Task 2.8: Shard Override Endpoint (`POST /memories/{id}/category`)**
  - Move point between `private` and `shared` shards.
  - If moving previously synced shareable memory to private: enqueue a delete tombstone to retract it from the fleet.

- [ ] **Task 2.9: Gate Evaluation & Verification (`tests/eval_gate.py`)**
  - Run 20+ test notes 5 times to confirm $\ge 90\%$ accuracy and zero category flips.

---

## 5. Code Specifications

### 5.1 SQLite Schema (`edge/edge/schema.sql`)
```sql
CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    point_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    base_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | inflight | done | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_outbox_status ON outbox(status, id);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    memory_id TEXT,
    data_json TEXT
);

CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    kind TEXT NOT NULL, -- version | contradiction
    local_json TEXT NOT NULL,
    remote_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open | resolved
    resolution TEXT, -- keep_local | keep_remote | merged
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

### 5.2 SQLite Client (`edge/edge/db.py`)
```python
import sqlite3
import threading
from edge.config import settings

settings.dir.mkdir(parents=True, exist_ok=True)
_conn = sqlite3.connect(
    settings.dir / "edge.db",
    check_same_thread=False,
    isolation_level=None
)
_conn.execute("PRAGMA journal_mode=WAL")
_conn.row_factory = sqlite3.Row
_lock = threading.Lock()

def execute(sql: str, params: tuple = ()):
    with _lock:
        return _conn.execute(sql, params)

def init():
    with open("edge/schema.sql") as f:
        _conn.executescript(f.read())
```

### 5.3 Event Emitter (`edge/edge/events.py`)
```python
import asyncio, json, time
from edge import db

_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None

def bind_loop(loop):
    global _loop
    _loop = loop

def emit(type_: str, memory_id: str | None = None, data: dict | None = None):
    ev = {
        "ts": int(time.time() * 1000),
        "type": type_,
        "memory_id": memory_id,
        "data": data or {}
    }
    db.execute(
        "INSERT INTO events(ts, type, memory_id, data_json) VALUES (?, ?, ?, ?)",
        (ev["ts"], type_, memory_id, json.dumps(ev["data"]))
    )
    if _loop:
        for q in list(_subscribers):
            _loop.call_soon_threadsafe(q.put_nowait, ev)

def subscribe() -> asyncio.Queue:
    q = asyncio.Queue()
    _subscribers.add(q)
    return q

def unsubscribe(q: asyncio.Queue):
    _subscribers.discard(q)
```

### 5.4 PII Pre-Filter (`edge/edge/gate/pii.py`)
```python
import re

RULES = {
    "phone": re.compile(r"(?:\+91[\s-]?)?[6-9]\d{9}\b|\+\d{1,3}[\s-]?\d{6,12}"),
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "access_code": re.compile(r"\b(gate|door|lock|alarm|wifi|site)\s*(code|pin|password|pwd)\b\D{0,12}\w{3,}", re.I),
    "password": re.compile(r"\b(password|passcode|pin|otp)\b\s*[:=is]*\s*\S+", re.I),
    "id_number": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),  # 12-digit format
    "money": re.compile(r"(rs\.?|inr|₹|\$)\s?\d[\d,]*", re.I),
    "address": re.compile(r"\b(flat|house|plot)\s*(no\.?|number)\s*\w+", re.I),
}

def scan(text: str) -> list[str]:
    return [name for name, rx in RULES.items() if rx.search(text)]
```

### 5.5 LLM Gate Prompts (`edge/edge/gate/prompts.py`)
```python
SYSTEM = """You route field-technician notes. Reply with JSON only.
Categories:
- shareable: a reusable technical fact about equipment (fault, cause, fix, part, setting).
- private: mentions a person, customer opinion, site access, money, or anything personal.
- routine: status or time-keeping with no reusable technical knowledge.
If a note mixes a technical fact with anything private, choose private.
reason: one short sentence, max 15 words."""

EXAMPLES = [
    ("P-200 cavitation noise fixed by replacing the worn impeller.", "shareable", "Reusable fix for a known pump fault."),
    ("C-14 trips on high temp when the intake filter is clogged; cleaning fixed it.", "shareable", "Cause and fix for a compressor trip."),
    ("Torque spec for panel B bus bars is 25 Nm, not 20.", "shareable", "Equipment setting others will need."),
    ("Site manager was rude about the delay, avoid him next visit.", "private", "Personal opinion about a person."),
    ("Customer unhappy with last invoice, do not discuss pricing.", "private", "Customer relationship and money."),
    ("Replaced seal on P-200; plant head asked me to keep the leak quiet.", "private", "Technical fact mixed with a sensitive request."),
    ("Reached site at 10:15, starting inspection.", "routine", "Time-keeping only."),
    ("Checked panel B, everything normal.", "routine", "Status with no new knowledge."),
    ("Lunch break, back in 30 minutes.", "routine", "Personal status, no knowledge."),
]

SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": ["shareable", "private", "routine"]},
        "reason": {"type": "string"}
    },
    "required": ["category", "reason"],
}

def messages(note: str) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM}]
    for text, cat, why in EXAMPLES:
        msgs.append({"role": "user", "content": text})
        msgs.append({"role": "assistant", "content": f'{{"category": "{cat}", "reason": "{why}"}}'})
    msgs.append({"role": "user", "content": note})
    return msgs
```

### 5.6 Gate Classifier Pipeline (`edge/edge/gate/gate.py`)
```python
import json
from dataclasses import dataclass, field
from ollama import Client
from edge.config import settings
from edge.gate import pii, prompts

_client = Client(host="http://localhost:11434", timeout=4)

@dataclass
class GateDecision:
    category: str
    source: str  # rule | llm | fallback | user
    reason: str
    pii_hits: list[str] = field(default_factory=list)

def _llm(note: str) -> dict:
    resp = _client.chat(
        model=settings.ollama_model,
        messages=prompts.messages(note),
        format=prompts.SCHEMA,
        options={"temperature": 0, "num_predict": 60}
    )
    out = json.loads(resp.message.content)
    assert out["category"] in ("shareable", "private", "routine")
    return out

def decide(note: str) -> GateDecision:
    # 1. Deterministic PII Rules (Unconditional)
    hits = pii.scan(note)
    if hits:
        return GateDecision("private", "rule", f"Matched rule: {', '.join(hits)}", hits)

    # 2. Local LLM Classification with retry
    for _ in range(2):
        try:
            out = _llm(note)
            return GateDecision(out["category"], "llm", out["reason"][:120])
        except Exception:
            continue

    # 3. Fail-Closed Fallback
    return GateDecision("private", "fallback", "Classifier unavailable; kept local by default")
```

### 5.7 Near-Duplicate Detection (`edge/edge/memory/dedup.py`)
```python
from qdrant_edge import Query, QueryRequest, Filter, FieldCondition, MatchValue
from edge.config import settings

def find_duplicate(shard, dense: list[float], asset_tag: str):
    must = [FieldCondition(key="asset_tag", match=MatchValue(value=asset_tag))] if asset_tag else None
    flt = Filter(must=must, must_not=[FieldCondition(key="deleted", match=MatchValue(value=True))])
    with shard.lock:
        hits = shard.shard.query(QueryRequest(
            query=Query.Nearest(dense, using="dense"),
            filter=flt,
            limit=1,
            with_payload=True
        ))
    if hits and hits[0].score >= settings.dedup_threshold:
        return hits[0]
    return None
```

### 5.8 Updated Memory Service Flow (`edge/edge/memory/service.py`)
```python
from edge.store.embed import embed_doc
from edge.store.shards import shard_for
from edge.gate.gate import decide
from edge.memory.dedup import find_duplicate
from edge import db, events
from qdrant_edge import Point, UpdateOperation
import time, uuid, json

def create_note(text: str, title: str = "", asset_tag: str = "") -> dict:
    vectors = embed_doc(text)
    decision = decide(text)
    target_shard = shard_for(decision.category)
    ts = int(time.time() * 1000)

    # Check for near-duplicate
    dup = find_duplicate(target_shard, vectors["dense"], asset_tag)
    if dup:
        cur = dup.payload
        cur["text"] = text
        cur["version"] += 1
        cur["base_version"] = dup.payload.get("version", 1)
        cur["updated_at"] = ts
        cur["merged_from"].append(str(uuid.uuid4()))
        with target_shard.lock:
            target_shard.shard.update(UpdateOperation.upsert_points([
                Point(id=dup.id, vector=vectors, payload=cur)
            ]))
        events.emit("dedup.merged", str(dup.id), {"version": cur["version"]})
        return cur

    # Create new point
    mid = str(uuid.uuid4())
    payload = {
        "memory_id": mid,
        "text": text,
        "title": title,
        "asset_tag": asset_tag,
        "category": decision.category,
        "gate_source": decision.source,
        "gate_reason": decision.reason,
        "pii_hits": decision.pii_hits,
        "device_id": settings.device_id,
        "author": settings.author,
        "version": 1,
        "base_version": 0,
        "created_at": ts,
        "updated_at": ts,
        "expires_at": (ts + settings.routine_ttl_days * 86400000) if decision.category == "routine" else None,
        "deleted": False,
        "merged_from": [],
        "sync_state": "pending" if decision.category == "shareable" else "local_only"
    }

    with target_shard.lock:
        target_shard.shard.update(UpdateOperation.upsert_points([
            Point(id=mid, vector=vectors, payload=payload)
        ]))

    # Enqueue in outbox if shareable (persisted for Phase 3 sync worker)
    if decision.category == "shareable":
        db.execute(
            "INSERT INTO outbox(memory_id, op, point_json, version, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (mid, "upsert", json.dumps({"id": mid, "vector": vectors, "payload": payload}), 1, 0, ts)
        )

    events.emit("gate.decided", mid, {"category": decision.category, "source": decision.source, "reason": decision.reason})
    events.emit("memory.created", mid, {"category": decision.category})
    return payload
```

---

## 6. Exit Criteria & Verification Tests

```bash
# 1. Run the gate evaluation suite across 5 repeated runs
python edge/tests/eval_gate.py

# Requirements to PASS:
# - Overall Accuracy >= 90%
# - Flips between runs = 0 (deterministic outputs)
# - False Shareables (private classified as shareable) = 0

# 2. Test Rule-based PII Override:
curl -X POST http://localhost:7001/memories \
  -H "Content-Type: application/json" \
  -d '{"text": "Gate code is 4431, P-200 seal replaced", "asset_tag": "P-200"}'
# Expected response: "category": "private", "gate_source": "rule", "pii_hits": ["access_code"]

# 3. Test Near-Duplicate Deduplication:
curl -X POST http://localhost:7001/memories \
  -H "Content-Type: application/json" \
  -d '{"text": "Replaced worn impeller on pump P-200 due to cavitation", "asset_tag": "P-200"}'
curl -X POST http://localhost:7001/memories \
  -H "Content-Type: application/json" \
  -d '{"text": "Pump P-200 cavitation noise stopped after new impeller installed", "asset_tag": "P-200"}'
# Expected response: single point updated with version 2 and merged_from containing 1 ID.

# 4. Test Fail-Closed Ollama Down Resilience:
killall ollama
curl -X POST http://localhost:7001/memories \
  -H "Content-Type: application/json" \
  -d '{"text": "Cleaned air intake filter on C-14 compressor", "asset_tag": "C-14"}'
# Expected response: "category": "private", "gate_source": "fallback" (Zero crash!)
```

---

## 7. Readiness for Phase 3 Checklist

- [ ] `gate_eval.jsonl` passes $\ge 90\%$ accuracy with zero flips across 5 runs.
- [ ] PII matches force `private` before any LLM execution.
- [ ] Deduplication correctly increments versions rather than inserting duplicate points.
- [ ] Shareable memories reliably write rows into the SQLite `outbox` table.
