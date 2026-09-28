import json
import re
from dataclasses import dataclass, field
from edge.config import settings
from edge.gate import pii, prompts

try:
    from ollama import Client
    _ollama_client = Client(host="http://localhost:11434", timeout=4)
except Exception:
    _ollama_client = None

@dataclass
class GateDecision:
    category: str
    source: str  # rule | llm | fallback | user
    reason: str
    pii_hits: list[str] = field(default_factory=list)

def _llm(note: str) -> dict:
    if not _ollama_client:
        raise RuntimeError("Ollama client unavailable")
    resp = _ollama_client.chat(
        model=settings.ollama_model,
        messages=prompts.messages(note),
        format=prompts.SCHEMA,
        options={"temperature": 0, "num_predict": 60}
    )
    out = json.loads(resp.message.content)
    assert out["category"] in ("shareable", "private", "routine")
    return out

# Local semantic heuristics when Ollama is not active on edge device
ROUTINE_PATTERNS = [
    re.compile(r"\b(reached site|arrived at|waiting for|starting inspection|daily inspection|routine inspection|routine|break|lunch|heading to|shift ended|shift handoff|status normal|everything normal|all gauges normal|no vibrations observed|checked panel|tools stowed)\b", re.I),
    re.compile(r"\b(at \d{1,2}:\d{2}|back in \d+ minutes|on site)\b", re.I)
]

PRIVATE_PATTERNS = [
    re.compile(r"\b(customer|client|invoice|pricing|price|cost|rude|bribe|angry|dispute|complaint|argument|quiet|secret|personal)\b", re.I),
    re.compile(r"\b(manager was|supervisor asked|told me to keep|avoid him|avoid her)\b", re.I)
]

SHAREABLE_PATTERNS = [
    re.compile(r"\b(cavitation|impeller|vibration|bearing|torque|spec|alignment|gland|lubricant|filter|tripped on|overheating|replaced|calibrated|pressure relief)\b", re.I)
]

def _heuristic_classify(note: str) -> GateDecision:
    """Deterministic local classifier fallback when local LLM server is not booted."""
    for p in PRIVATE_PATTERNS:
        if p.search(note):
            return GateDecision("private", "fallback", "Sensitive business or interpersonal mention identified")

    for p in ROUTINE_PATTERNS:
        if p.search(note):
            return GateDecision("routine", "fallback", "Status or timekeeping event without reusable equipment insight")

    for p in SHAREABLE_PATTERNS:
        if p.search(note):
            return GateDecision("shareable", "fallback", "Reusable industrial equipment diagnosis or repair procedure")

    # Fail closed by default: If uncertain, keep it private on-device so sensitive data never leaks
    return GateDecision("private", "fallback", "Classifier unconfident; routed to private by default")

def decide(note: str) -> GateDecision:
    # 1. Deterministic PII Rules (Zero Latency, Absolute Authority)
    hits = pii.scan(note)
    if hits:
        return GateDecision("private", "rule", f"Matched rule: {', '.join(hits)}", hits)

    # 2. Local Ollama LLM (gemma3:1b if installed and running)
    if _ollama_client:
        for _ in range(2):
            try:
                out = _llm(note)
                return GateDecision(out["category"], "llm", out["reason"][:120])
            except Exception:
                continue

    # 3. Deterministic Heuristic Fallback (Fail Closed)
    return _heuristic_classify(note)
