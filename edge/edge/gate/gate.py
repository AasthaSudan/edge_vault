import json
import re
from dataclasses import dataclass, field
from edge.gate import pii, prompts, context, policy
from edge.gate.prompts import TECH_SIGNALS, PRIVATE_SIGNALS
from edge.llm import client as llm


@dataclass
class GateDecision:
    category: str
    source: str                      # rule | llm | fallback | user | pending | user_approved
    reason: str
    pii_hits: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    context_used: dict = field(default_factory=dict)

    @property
    def sanitize_candidate(self) -> bool:
        return self.category == "private" and bool(set(self.signals) & TECH_SIGNALS)


# Local semantic heuristics when Ollama server is not running on device
ROUTINE_PATTERNS = [
    re.compile(r"\b(reached site|arrived at|waiting for|starting inspection|daily inspection|routine inspection|routine|break|coffee|lunch|heading to|shift ended|shift handoff|shift handover|handover log|walked perimeter|perimeter|emergency lights|operational|logged in|front desk|visitor badge|status normal|everything normal|all gauges normal|no vibrations observed|checked panel|tools stowed|returning to|next week)\b", re.I),
    re.compile(r"\b(at \d{1,2}:\d{2}|back in \d+ minutes|on site)\b", re.I)
]

PRIVATE_PATTERNS = [
    re.compile(r"\b(customer|client|invoice|pricing|price|cost|rude|bribe|angry|dispute|complaint|argument|quiet|secret|personal|confidential|laptop charger|cafeteria|gate key|key is hidden|hidden behind|combination lock|security pin|terminal login|labor charges|billing)\b", re.I),
    re.compile(r"\b(manager was|supervisor asked|plant head asked|told me to keep|avoid him|avoid her|asked me to keep|complained about)\b", re.I)
]

SHAREABLE_PATTERNS = [
    re.compile(r"\b(cavitation|impeller|vibration|bearing|torque|spec|alignment|gland|lubricant|filter|tripped on|overheating|overheat|replaced|replacing|fixed|seal|leak|valve|pump|compressor|gasket|calibrated|pressure relief|cleaning|cleaned|thermal paste|heat sink|zero offset|pressure sensor|oil return|anchor bolts|ceramic fuse|fast-acting|optical sensor|isopropyl alcohol|ramp-up|vfd|overcurrent|ribbon cable|touch response|cylinder head|weld seams|flange bolts|intake fans|belt tension)\b", re.I)
]


def rule_check(text: str) -> GateDecision | None:
    hits = pii.scan(text)
    if hits:
        signals = ["credential"] if any(h in ("password", "pin", "access_code", "lock_combination") for h in hits) else ["personal"]
        text_lower = text.lower()
        if any(p.search(text) for p in SHAREABLE_PATTERNS) or any(w in text_lower for w in ("seal", "leak", "pump", "valve", "filter", "temp", "pressure", "vibration", "bearing", "torque", "impeller", "fix", "fixed", "replaced", "calibrated")):
            signals.append("equipment_fix")
        return GateDecision(
            category="private",
            source="rule",
            reason=f"Matched rule: {', '.join(hits)}",
            pii_hits=hits,
            signals=signals,
            flags=["rule_hit"]
        )
    return None


def _heuristic_signals(text: str) -> list[str]:
    """Keyword signals used only when the LLM is unavailable. They never decide egress."""
    signals = []
    text_lower = text.lower()

    if any(p.search(text) for p in PRIVATE_PATTERNS):
        if "customer" in text_lower or "client" in text_lower:
            signals.append("customer")
        if "pricing" in text_lower or "invoice" in text_lower or "cost" in text_lower:
            signals.append("money")
        if "manager" in text_lower or "supervisor" in text_lower or "person" in text_lower or "rude" in text_lower:
            signals.append("person")
        if not signals:
            signals.append("personal")

    if any(p.search(text) for p in SHAREABLE_PATTERNS):
        if "torque" in text_lower or "spec" in text_lower or "setting" in text_lower or "bar" in text_lower:
            signals.append("equipment_setting")
        if "replaced" in text_lower or "fixed" in text_lower or "cleaned" in text_lower or "calibrated" in text_lower:
            signals.append("equipment_fix")
        if "impeller" in text_lower or "bearing" in text_lower or "seal" in text_lower or "filter" in text_lower:
            signals.append("part_or_spec")
        if "cavitation" in text_lower or "vibration" in text_lower or "tripped" in text_lower or "leak" in text_lower:
            signals.append("equipment_fault")

    if any(p.search(text) for p in ROUTINE_PATTERNS):
        if "at " in text_lower or "minutes" in text_lower or "shift" in text_lower:
            signals.append("time_keeping")
        else:
            signals.append("status")

    return signals


def _fallback(text: str, ctx: dict) -> GateDecision:
    """Fail closed (spec §7.7): without an LLM verdict a note is ALWAYS private.
    Keyword signals are kept so a technical note can still yield a Split & Share
    suggestion, which needs human approval before anything leaves the device."""
    return GateDecision(
        "private", "fallback", "Classifier unavailable; kept local by default",
        signals=_heuristic_signals(text), flags=["llm_unavailable"], context_used=ctx
    )


def decide_v2(text: str, dense: list[float], memory_id: str | None = None) -> GateDecision:
    ruled = rule_check(text)
    if ruled:
        return ruled

    nbrs = context.neighbours(dense, exclude_id=memory_id)
    corr = context.similar_corrections(dense)
    ctx = {"neighbours": len(nbrs), "corrections": len(corr)}

    for _ in range(2):
        try:
            out = llm.chat_json(prompts.messages(text, nbrs, corr), prompts.SCHEMA, num_predict=90)
            if out.get("category") not in ("shareable", "private", "routine"):
                raise ValueError("bad category")
            cat, reason, flags = policy.apply(out, nbrs, corr, text=text)
            return GateDecision(
                category=cat,
                source="llm",
                reason=reason,
                signals=out.get("signals", []),
                flags=flags,
                context_used=ctx
            )
        except Exception:
            continue

    # Fallback when LLM is offline or timed out
    return _fallback(text, ctx)


def decide(text: str) -> GateDecision:
    """Legacy compatibility wrapper for Phase 2 tests and services."""
    from edge.store.embed import embed_doc
    dense = embed_doc(text)["dense"]
    return decide_v2(text, dense)
