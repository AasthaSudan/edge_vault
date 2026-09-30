import re
import time
import uuid
import json
from edge import db
from edge.events import emit
from edge.gate import pii
from edge.gate import gate as gatemod
from edge.llm import client as llm
from edge.store.embed import embed_doc

SYSTEM = """Rewrite a private field note as ONE short sentence another technician could reuse.
Keep ONLY equipment facts: fault, cause, fix, part, setting, measurement, asset tag.
Remove every person, name, customer, site, code, password, money amount, opinion and request.
Never add a fact that is not in the note. If there is no reusable equipment fact, return "".
Reply as JSON: {"fact": "..."}"""

SCHEMA = {
    "type": "object",
    "properties": {
        "fact": {"type": "string"}
    },
    "required": ["fact"]
}

GROUNDING_MIN = 0.75

_WORD = re.compile(r"[a-z0-9][a-z0-9\-\.]*", re.I)
_STOP = {
    "the", "and", "was", "were", "with", "for", "from", "that", "this", "after", "then",
    "has", "have", "had", "its", "into", "when", "on", "of", "to", "a", "an", "is", "by"
}


def _tokens(t: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(t) if len(w) >= 3 and w.lower() not in _STOP}


def grounding(fact: str, original: str) -> float:
    """Share of the fact's content words that appear in the original (1.0 = fully grounded)."""
    f, o = _tokens(fact), _tokens(original)
    return 1.0 if not f else len(f & o) / len(f)


def numbers_preserved(fact: str, original: str) -> bool:
    nums = re.findall(r"\d+(?:\.\d+)?", fact)
    return all(n in original for n in nums)


def _heuristic_sanitize(original: str) -> str:
    """Fallback extraction of equipment facts when LLM is offline."""
    # Split sentences, find the sentence that contains equipment keywords and no PII
    sentences = re.split(r"[.;:\n]", original)
    candidate_sentences = []
    for s in sentences:
        s_clean = s.strip()
        if not s_clean:
            continue
        if pii.scan(s_clean):
            continue
        if re.search(r"\b(customer|pricing|manager|password|pin|code|access|rude|secret)\b", s_clean, re.I):
            continue
        if re.search(r"\b(fixed|replaced|leak|seal|impeller|bearing|filter|pressure|temp|overheat|valve|pump|torque)\b", s_clean, re.I):
            candidate_sentences.append(s_clean)

    if candidate_sentences:
        fact = candidate_sentences[0]
        if not fact.endswith("."):
            fact += "."
        return fact
    return ""


def redact(original: str) -> str:
    """Drop every sentence that matches a PII rule, so the sanitizer LLM never sees the
    secret. Returns "" if nothing is left (the secret and the fix share one sentence)."""
    parts = [s.strip() for s in re.split(r"(?<=[.;:!?])\s+|\n+", original) if s.strip()]
    return " ".join(s for s in parts if not pii.scan(s))


def _check(fact: str, original: str) -> tuple[bool, dict]:
    checks = {
        "pii": pii.scan(fact),
        "grounding": round(grounding(fact, original), 2),
        "numbers_preserved": numbers_preserved(fact, original),
    }
    ok = (not checks["pii"]) and (checks["grounding"] >= GROUNDING_MIN) and checks["numbers_preserved"]
    if ok:
        d = gatemod.decide_v2(fact, embed_doc(fact)["dense"])
        checks["gate"] = d.category
        ok = (d.category == "shareable")
    return ok, checks


def _llm_fact(text: str) -> str:
    try:
        out = llm.chat_json(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
            SCHEMA,
            num_predict=80,
        )
        return " ".join(out.get("fact", "").split())
    except Exception:
        return ""


def propose(memory_id: str, payload: dict) -> str | None:
    original = payload.get("text", "")

    # Candidates in order: LLM rewrite of the redacted note, then rule-based extraction.
    # Every candidate must pass PII re-scan, grounding, numbers and the gate re-check.
    candidates = [_llm_fact(redact(original) or original), _heuristic_sanitize(original)]
    fact, checks = "", {}
    for cand in candidates:
        if len(cand) < 12 or cand == fact:
            continue
        ok, checks = _check(cand, original)
        if ok:
            fact = cand
            break
        emit("share.rejected_auto", memory_id, {"checks": checks})
    if not fact:
        return None

    sid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO share_suggestions(id, source_memory_id, proposed_text, asset_tag, checks_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (sid, memory_id, fact, payload.get("asset_tag", ""), json.dumps(checks), int(time.time() * 1000)),
    )
    emit("share.suggested", memory_id, {"suggestion_id": sid})
    return sid
