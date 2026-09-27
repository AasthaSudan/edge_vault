import sqlite3
import threading
from pathlib import Path
from edge.config import settings

settings.dir.mkdir(parents=True, exist_ok=True)
_db_path = settings.dir / "edge.db"

_conn = sqlite3.connect(
    str(_db_path),
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
    schema_path = Path(__file__).parent / "schema.sql"
    with open(schema_path, "r", encoding="utf-8") as f:
        with _lock:
            _conn.executescript(f.read())

# Auto-initialize on import so tables exist immediately
init()
