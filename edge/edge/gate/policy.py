import re

from edge.gate.prompts import PRIVATE_SIGNALS, TECH_SIGNALS

TRUSTED_SOURCES = {"user", "rule", "user_approved"}

# An equipment setting or reading: "set pressure is 12 bar", "torque to 25 Nm", "1450 rpm"
_READING = re.compile(r"\d+(?:\.\d+)?\s*(?:bar|psi|kpa|mpa|nm|rpm|hz|kv|kw|mm/s|°c|°f)(?![a-z])", re.I)


def apply(llm_out: dict, neighbours: list[dict], corrections: list[dict], text: str = "") -> tuple[str, str, list[str]]:
    """Returns (category, reason, flags). Can DOWNGRADE to private. The one upgrade: the small model
    sometimes files an equipment reading as time-keeping ("set pressure is 12 bar" -> routine); such a
    note is treated as shareable and still goes through every veto below."""
    cat = llm_out.get("category", "private")
    sig = set(llm_out.get("signals", []))
    reason = llm_out.get("reason", "")[:120]

    if cat == "routine" and _READING.search(text):
        cat, reason = "shareable", "Equipment setting or reading, useful to the team"
        sig = (sig - {"time_keeping"}) | {"equipment_setting"}

    if cat != "shareable":
        return cat, reason, []

    if sig & PRIVATE_SIGNALS:
        return "private", f"Veto: sensitive signal ({', '.join(sorted(sig & PRIVATE_SIGNALS))})", ["signal_veto"]

    if not (sig & TECH_SIGNALS):
        return "private", "Veto: no technical content detected", ["no_tech_veto"]

    # A very similar correction to private is a strong on-device precedent.
    if any(c.get("user_category") == "private" for c in corrections[:1]):
        return "private", "Veto: technician kept a very similar note private", ["correction_veto"]

    strong_private = [
        n for n in neighbours[:3]
        if n.get("score", 0) >= 0.80 and n.get("category") == "private"
        and n.get("gate_source") in TRUSTED_SOURCES
    ]
    if len(strong_private) >= 2:
        return "private", "Veto: near-identical notes were kept private", ["neighbour_veto"]

    return "shareable", reason, []
