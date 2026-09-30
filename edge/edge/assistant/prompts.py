from datetime import datetime
from edge.config import settings

SYSTEM = """You are EdgeVault, an offline assistant for field technicians. You run entirely on this device.
Answer ONLY using the numbered notes provided. After each fact you use, add its note number in
square brackets, like [2]. Copy exact values (codes, part numbers, torque, pressure, temperature)
exactly as written. If the notes do not contain the answer, reply exactly:
"I don't have that in this device's memory." Do not guess. Keep answers under 5 short sentences."""

LABEL = {"shareable": "FLEET", "private": "PRIVATE", "routine": "ROUTINE"}

# One worked exchange showing the citation format. Static, so Ollama reuses its prompt cache.
EXAMPLE_USER = """NOTES:
[1] (FLEET · from device-c · 2026-01-10 · K-7) Kiln K-7 fan fix: Kiln K-7 exhaust fan tripping was fixed by replacing the worn drive belt and setting tension to 12 mm deflection.
[2] (PRIVATE · this device · 2026-01-12) Store room: Store room padlock combination is 5190.

QUESTION: How was the K-7 fan fixed and what is the store room combination?"""
EXAMPLE_ANSWER = ("The K-7 exhaust fan was fixed by replacing the worn drive belt and setting tension "
                  "to 12 mm deflection [1]. The store room padlock combination is 5190 [2].")
REFUSAL_USER = """NOTES:
[1] (FLEET · from device-c · 2026-01-10 · K-7) Kiln K-7 fan fix: Kiln K-7 exhaust fan tripping was fixed by replacing the worn drive belt.

QUESTION: How do I replace the gearbox on crusher CR-2?"""
REFUSAL_ANSWER = "I don't have that in this device's memory."


def _origin(r: dict) -> str:
    return "this device" if r.get("device_id") == settings.device_id else f"from {r.get('device_id')}"


def context_block(results: list[dict]) -> tuple[str, list[dict]]:
    lines, sources, used = [], [], 0
    for i, r in enumerate(results, start=1):
        ts = r.get("updated_at") or r.get("created_at") or 0
        date = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
        tag = f" · {r['asset_tag']}" if r.get("asset_tag") else ""
        head = f"[{i}] ({LABEL.get(r.get('category'), '?')} · {_origin(r)} · {date}{tag})"
        body = " ".join(f"{r.get('title', '')}: {r.get('text', '')}".split())
        line = f"{head} {body}"
        if used + len(line) > settings.assistant_context_chars:
            break
        lines.append(line)
        used += len(line)
        sources.append({
            "n": i,
            "memory_id": r["id"],
            "category": r.get("category"),
            "title": r.get("title"),
            "asset_tag": r.get("asset_tag"),
            "text": r.get("text", ""),
            "origin": _origin(r),
            "score": r.get("score")
        })
    return "\n".join(lines), sources


def build(question: str, results: list[dict], history: list[dict]) -> tuple[list[dict], list[dict]]:
    block, sources = context_block(results)
    msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": EXAMPLE_USER},
        {"role": "assistant", "content": EXAMPLE_ANSWER},
        {"role": "user", "content": REFUSAL_USER},
        {"role": "assistant", "content": REFUSAL_ANSWER},
    ]
    for h in history[-2 * settings.assistant_history_turns:]:
        msgs.append({"role": h["role"], "content": h["content"]})
    notes = block if block else "(no notes found)"
    msgs.append({"role": "user", "content": f"NOTES:\n{notes}\n\nQUESTION: {question}"})
    return msgs, sources
