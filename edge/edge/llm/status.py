from edge.config import settings
from edge.llm import client as llm
from edge import db

def get_status() -> dict:
    try:
        pending = db.execute("SELECT COUNT(*) FROM gate_jobs WHERE status IN ('pending','inflight')").fetchone()[0]
    except Exception:
        pending = 0

    return {
        "model": settings.ollama_model,
        "host": settings.llm_host,
        "loaded": llm.loaded_models(),
        "stats": llm.stats(),
        "gate_queue": pending,
        "gate_mode": settings.gate_mode,
    }
