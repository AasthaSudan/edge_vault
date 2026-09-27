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
        "category": {
            "type": "string",
            "enum": ["shareable", "private", "routine"]
        },
        "reason": {
            "type": "string"
        }
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
