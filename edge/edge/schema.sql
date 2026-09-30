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
    created_at INTEGER NOT NULL,
    analysis_json TEXT -- cached on-device LLM reconciliation (see assistant/reconcile.py)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

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

