"""On-device LLM reconciliation of a sync conflict (two fleet reports about one asset).

Explains in one sentence whether the reports are a progression over time, a genuine
contradiction, or the same fact, and recommends a resolution. Only shareable fleet notes
reach this prompt (conflicts exist only for pushed notes), and the result is advisory:
the technician still picks the resolution.
"""
import re
import time
from datetime import datetime
from edge.gate import pii
from edge.gate.sanitize import grounding, numbers_preserved, GROUNDING_MIN
from edge.config import settings
from edge.llm import client as llm

RELATIONS = ["progression", "contradiction", "same_fact"]
ACTIONS = ["keep_local", "keep_remote", "merge"]

SYSTEM = """You compare two field-technician reports about the same equipment and reply with JSON only.
relation:
- progression: the equipment's condition changed between the two dates (e.g. normal on Monday, leaking on Wednesday). Both can be true.
- contradiction: they disagree about something that should not change by itself: a spec, setting, rating, part number or instruction (e.g. 25 Nm vs 20 Nm).
- same_fact: both say the same thing in different words.
explanation: ONE sentence, max 30 words, naming the devices and days, e.g. "Device A reported normal pressure on Mon; Device B reported a leak on Wed: likely progression, not a contradiction."
recommendation: keep_local, keep_remote or merge. For a progression keep the NEWER report unless both facts stay useful (then merge). For same_fact choose merge.
merged_text: only when recommending merge: one or two sentences using ONLY facts and numbers from the two reports; otherwise ""."""

SCHEMA = {
    "type": "object",
    "properties": {
        "relation": {"type": "string", "enum": RELATIONS},
        "explanation": {"type": "string"},
        "recommendation": {"type": "string", "enum": ACTIONS},
        "merged_text": {"type": "string"},
    },
    "required": ["relation", "explanation", "recommendation", "merged_text"],
}

# One worked example (static prefix, cache-friendly)
EXAMPLE_USER = """ASSET: P-7
LOCAL report (this device, device-a, Mon 2026-03-02): P-7 discharge pressure normal at 4.2 bar, no leaks.
REMOTE report (device-b, Wed 2026-03-04): P-7 mechanical seal leaking, pressure dropped to 3.1 bar."""
EXAMPLE_ANSWER = ('{"relation": "progression", "explanation": "device-a reported normal 4.2 bar on Mon; '
                  'device-b reported a seal leak at 3.1 bar on Wed: likely progression, not a contradiction.", '
                  '"recommendation": "keep_remote", "merged_text": ""}')
EXAMPLE2_USER = """ASSET: V-3
LOCAL report (this device, device-a, Tue 2026-03-03): Relief valve V-3 set pressure is 10 bar.
REMOTE report (device-c, Thu 2026-03-05): Relief valve V-3 set pressure is 12 bar."""
EXAMPLE2_ANSWER = ('{"relation": "contradiction", "explanation": "device-a says V-3 is set to 10 bar, device-c says 12 bar: '
                   'a setting or spec does not drift on its own, so this is a genuine contradiction to verify on site.", '
                   '"recommendation": "merge", "merged_text": ""}')


def _when(p: dict) -> str:
    ts = p.get("updated_at") or p.get("created_at")
    return datetime.fromtimestamp(ts / 1000).strftime("%a %Y-%m-%d") if ts else "unknown date"


def _writer(p: dict, this_device: bool) -> str:
    """Who wrote this version: the local edit is ours; the remote one was pushed by pushed_by."""
    if this_device:
        return settings.device_id
    return p.get("pushed_by") or p.get("device_id") or "another device"


def _line(label: str, p: dict, this_device: bool) -> str:
    who = f"this device, {_writer(p, True)}" if this_device else _writer(p, False)
    return f"{label} report ({who}, {_when(p)}): {' '.join((p.get('text') or '').split())}"


def messages(local: dict, remote: dict) -> list[dict]:
    asset = local.get("asset_tag") or remote.get("asset_tag") or "unknown"
    user = "\n".join([f"ASSET: {asset}", _line("LOCAL", local, True), _line("REMOTE", remote, False)])
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": EXAMPLE_USER},
        {"role": "assistant", "content": EXAMPLE_ANSWER},
        {"role": "user", "content": EXAMPLE2_USER},
        {"role": "assistant", "content": EXAMPLE2_ANSWER},
        {"role": "user", "content": user},
    ]


_UNIT_VALUE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(nm|bar|psi|kpa|mpa|°c|c|°f|f|v|kv|a|ma|kw|w|hz|rpm|mm|cm|m|gpm|lpm|lbs|kg|%)\b", re.I)
_PART_NUMBER = re.compile(r"\b\d{3,6}(?:-[a-z0-9]+)?\b", re.I)


def value_differences(a: str, b: str) -> list[str]:
    """Measured values / part numbers that disagree between two reports, e.g. ["25 nm vs 20 nm"]."""
    diffs = []
    va, vb = {}, {}
    for text, vals in ((a, va), (b, vb)):
        for num, unit in _UNIT_VALUE.findall(text):
            vals.setdefault(unit.lower().lstrip("°"), set()).add(num)
    for unit in va.keys() & vb.keys():
        if va[unit] != vb[unit]:
            diffs.append(f"{'/'.join(sorted(va[unit]))} {unit} vs {'/'.join(sorted(vb[unit]))} {unit}")
    pa = {p.lower() for p in _PART_NUMBER.findall(_UNIT_VALUE.sub(" ", a))}
    pb = {p.lower() for p in _PART_NUMBER.findall(_UNIT_VALUE.sub(" ", b))}
    if pa and pb and (pa - pb or pb - pa):
        diffs.append(f"{'/'.join(sorted(pa))} vs {'/'.join(sorted(pb))}")
    return diffs


OPPOSITES = [("open", "closed"), ("open", "close"), ("on", "off"), ("increase", "decrease"), ("raise", "lower"),
             ("clockwise", "counterclockwise"), ("clockwise", "anticlockwise"), ("enable", "disable"),
             ("energized", "de-energized"), ("before", "after"), ("must", "must not"), ("do", "do not")]


def opposite_terms(a: str, b: str) -> list[str]:
    """Opposite instructions between two reports, e.g. ["closed vs open"]."""
    wa = set(re.findall(r"[a-z]+(?:-[a-z]+)?(?:\s+not)?", a.lower()))
    wb = set(re.findall(r"[a-z]+(?:-[a-z]+)?(?:\s+not)?", b.lower()))
    out = []
    for x, y in OPPOSITES:
        if (x in wa and y in wb and y not in wa and x not in wb) or (y in wa and x in wb and x not in wa and y not in wb):
            out.append(f"{x if x in wa else y} vs {y if y in wb else x}")
    return out


def _newer(local: dict, remote: dict) -> str:
    return "keep_local" if (local.get("updated_at") or 0) >= (remote.get("updated_at") or 0) else "keep_remote"


def _fallback(local: dict, remote: dict) -> dict:
    newer = _newer(local, remote)
    return {
        "relation": "unknown",
        "explanation": "On-device model unavailable; compare the two reports and their dates manually.",
        "recommendation": newer,
        "merged_text": "",
        "source": "fallback",
    }


def analyze(local: dict, remote: dict) -> dict:
    t0 = time.perf_counter()
    try:
        out = llm.chat_json(messages(local, remote), SCHEMA, num_predict=160)
        if out.get("relation") not in RELATIONS or out.get("recommendation") not in ACTIONS:
            raise ValueError("bad enum")
    except Exception:
        res = _fallback(local, remote)
        res["ms"] = round((time.perf_counter() - t0) * 1000)
        return res

    # Deterministic correction: two reports cannot be "the same fact" if their values differ.
    diffs = value_differences(local.get("text", ""), remote.get("text", "")) +         opposite_terms(local.get("text", ""), remote.get("text", ""))
    if out["relation"] == "same_fact" and diffs:
        out.update(
            relation="contradiction",
            explanation=(f"{_writer(local, True)} and {_writer(remote, False)} report different values "
                         f"({'; '.join(diffs)}): a genuine contradiction to verify on site."),
            recommendation="merge",
            merged_text="",
        )
        corrected = True
    else:
        corrected = False
    # A progression means the newer report describes the current state.
    if out["relation"] == "progression" and out["recommendation"] != "merge":
        corrected = corrected or out["recommendation"] != _newer(local, remote)
        out["recommendation"] = _newer(local, remote)

    both = f"{local.get('text', '')} {remote.get('text', '')}"
    merged = " ".join((out.get("merged_text") or "").split())
    # A merge suggestion is shown only if it is grounded in the two reports, keeps their
    # numbers exact and carries no PII; otherwise the technician writes the merge.
    if merged and (pii.scan(merged) or grounding(merged, both) < GROUNDING_MIN or not numbers_preserved(merged, both)):
        merged = ""
    return {
        "relation": out["relation"],
        "explanation": " ".join(out.get("explanation", "").split())[:300],
        "recommendation": out["recommendation"],
        "merged_text": merged if out["recommendation"] == "merge" else "",
        "source": "llm+rule" if corrected else "llm",
        "value_differences": diffs,
        "ms": round((time.perf_counter() - t0) * 1000),
    }
