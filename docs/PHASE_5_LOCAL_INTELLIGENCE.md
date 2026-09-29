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

### 1.1 Ollama setup (Windows / PowerShell / macOS)

```bash
# Pull while online (once)
ollama pull qwen2.5:1.5b
ollama pull gemma3:1b          # fallback

# Server settings
export OLLAMA_HOST="127.0.0.1:11434"      # loopback only; never 0.0.0.0 on the demo laptop
export OLLAMA_NUM_PARALLEL=1              # CPU: one generation at a time, requests queue
export OLLAMA_MAX_LOADED_MODELS=1         # never hold two models in RAM
export OLLAMA_KEEP_ALIVE="30m"            # keep the model resident between calls

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
