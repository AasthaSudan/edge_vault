import threading
import time
from edge import db
from edge.events import emit

_wake = threading.Event()


def notify():
    _wake.set()


def _claim():
    try:
        row = db.execute("SELECT * FROM gate_jobs WHERE status='pending' ORDER BY id LIMIT 1").fetchone()
        if row:
            db.execute("UPDATE gate_jobs SET status='inflight', attempts=attempts+1 WHERE id=?", (row["id"],))
        return row
    except Exception:
        return None


def _run():
    from edge.memory import service
    from edge.gate import sanitize

    while True:
        job = _claim()
        if not job:
            _wake.wait(timeout=3)
            _wake.clear()
            continue

        mid = job["memory_id"]
        status = "done"
        try:
            sh, rec = service.get(mid)
            if rec is None or rec.payload.get("deleted"):
                status = "cancelled"
            elif job["kind"] == "classify":
                p = rec.payload
                if p.get("gate_source") != "pending":
                    status = "cancelled"
                else:
                    service.finalize(
                        mid,
                        p.get("text", ""),
                        p.get("title", ""),
                        p.get("asset_tag", ""),
                        p.get("created_at", int(time.time() * 1000)),
                        provisional=True,
                        dedup=not p.get("derived", False),
                    )
                    status = "done"
            elif job["kind"] == "sanitize":
                sanitize.propose(mid, rec.payload)
                status = "done"
        except Exception as e:
            status = "failed"
            emit("gate.error", mid, {"kind": job["kind"], "error": str(e)[:200]})

        try:
            db.execute("UPDATE gate_jobs SET status=? WHERE id=?", (status, job["id"]))
        except Exception:
            pass


def start():
    try:
        db.execute("UPDATE gate_jobs SET status='pending' WHERE status='inflight'")
    except Exception:
        pass
    threading.Thread(target=_run, name="gate-worker", daemon=True).start()
