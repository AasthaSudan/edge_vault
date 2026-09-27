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
