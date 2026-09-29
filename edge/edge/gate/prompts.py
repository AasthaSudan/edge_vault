import json

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


def _answer(cat: str, sig: list[str], why: str) -> str:
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
        parts += [f'- [{n.get("category", "")}, {n.get("gate_source", "")}] "{_clip(n.get("text", ""))}"' for n in neighbours]
    parts.append("NOTE TO CLASSIFY:")
    parts.append(note)
    msgs.append({"role": "user", "content": "\n".join(parts)})
    return msgs
