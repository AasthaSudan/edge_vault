import re
import time
from edge.assistant import retrieve as R, prompts as P, sessions as S
from edge.events import emit
from edge.llm import client as llm

CITE = re.compile(r"\[(\d{1,2})\]")
GROUPED_CITE = re.compile(r"\[(\d{1,2}(?:\s*,\s*\d{1,2})+)\]")
REFUSAL = "I don't have that in this device's memory."
_WORD = re.compile(r"[a-z0-9][a-z0-9\-\.]*", re.I)
_STOP = {"the", "and", "was", "were", "with", "for", "from", "that", "this", "what", "how",
         "you", "your", "are", "has", "have", "had", "its", "into", "when", "then", "to", "is", "by"}
ATTRIBUTE_MIN = 0.5  # share of a sentence's content words that must come from one note


def _tokens(t: str) -> set[str]:
    return {w.lower().rstrip(".") for w in _WORD.findall(t) if len(w) >= 3 and w.lower() not in _STOP}


_NOT_IN_NOTES = re.compile(
    r"\b(not|no)\s+(specifically\s+)?(mentioned|provided|specified|found|available|given|listed|included|stated|information)\b"
    r"|\bdoes(n't| not)\s+(have|contain|mention|include)\b", re.I)


def ungrounded_reason(text: str, sources: list[dict]) -> str | None:
    """Deterministic checks run on every answer. Returns why it must become a refusal."""
    if CITE.search(text) is None and _NOT_IN_NOTES.search(text):
        return "refusal_paraphrase"          # "not mentioned in the notes" == canonical refusal
    corpus = " ".join(f"{s.get('title') or ''} {s.get('text') or ''} {s.get('asset_tag') or ''}" for s in sources).upper()
    for tag in {m.group(0) for m in R.ASSET_TAG.finditer(text.upper())}:
        if tag not in corpus:
            return f"unknown_asset:{tag}"    # names equipment that no source mentions
    return None


def attribute(text: str, sources: list[dict]) -> str:
    """Backstop for small models that skip the [n] format: cite each sentence with the
    source whose words it uses most (>= ATTRIBUTE_MIN overlap). Sentences no note
    supports stay uncited, so they show as ungrounded instead of borrowing a citation."""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", text.strip()):
        words = _tokens(sent)
        best_n, best = None, 0.0
        for s in sources:
            src = _tokens(f"{s.get('title', '')} {s.get('text', '')}")
            score = len(words & src) / len(words) if words else 0.0
            if score > best:
                best_n, best = s["n"], score
        if best_n is not None and best >= ATTRIBUTE_MIN and not CITE.search(sent):
            sent = re.sub(r"([.!?]?)$", f" [{best_n}]\\1", sent, count=1)
        out.append(sent)
    return " ".join(out)


def _extractive_fallback_answer(question: str, sources: list[dict]) -> str:
    """Intelligent offline extractive answer when local LLM server is not booted."""
    if not sources:
        return REFUSAL

    q_lower = question.lower()
    q_words = [
        w for w in re.findall(r"\w+", q_lower)
        if len(w) > 2 and w not in ("what", "how", "where", "when", "does", "this", "that", "the", "and", "for", "with", "from")
    ]
    if not q_words:
        return REFUSAL

    # Extract any specific entities or codes in the question (e.g. P-900, DG-88, LN-3)
    specific_tags = re.findall(r"\b[A-Za-z]+-\d+\b", question)

    answer_parts = []
    seen_indices = set()

    for s in sources[:3]:
        n = s["n"]
        text = s.get("text", "")
        text_lower = text.lower()

        # If question specifically asked about an asset tag that isn't in this note, skip
        if specific_tags and not any(tag.lower() in text_lower for tag in specific_tags):
            continue

        # Look for sentences with strong keyword overlap (>= 2 keywords, or all if len < 2)
        sentences = re.split(r"[.;\n]", text)
        for sent in sentences:
            sent_clean = sent.strip()
            if len(sent_clean) < 15:
                continue
            matched_words = [w for w in q_words if w in sent_clean.lower()]
            if len(matched_words) >= min(2, len(q_words)):
                answer_parts.append(f"{sent_clean} [{n}]")
                seen_indices.add(n)
                break

    if answer_parts:
        return " ".join(answer_parts[:2])

    return REFUSAL


def ask(session_id: str | None, question: str, scope: str = "device"):
    """Generator of NDJSON-ready events: sources -> token* -> done."""
    t0 = time.perf_counter()
    session_id = session_id or S.create(title=question[:60], scope=scope)
    history = S.history(session_id)
    prev_q = next((h["content"] for h in reversed(history) if h["role"] == "user"), None)

    got = R.retrieve(question, scope=scope, prev_question=prev_q)
    msgs, sources = P.build(question, got["results"], history)
    yield {"type": "sources", "session_id": session_id, "sources": sources, "retrieve_ms": got["ms"]}

    answer = []
    first_token_ms = None

    if not sources:
        answer.append(REFUSAL)
        yield {"type": "token", "text": REFUSAL}
    else:
        streamed_ok = False
        try:
            for piece in llm.chat_stream(msgs):
                if first_token_ms is None:
                    first_token_ms = round((time.perf_counter() - t0) * 1000, 1)
                answer.append(piece)
                yield {"type": "token", "text": piece}
            streamed_ok = True
        except Exception:
            pass

        if not streamed_ok:
            # Fall back to high-fidelity extractive answering from retrieved notes
            first_token_ms = round((time.perf_counter() - t0) * 1000, 1)
            fallback_text = _extractive_fallback_answer(question, sources)
            # Yield tokens in chunks
            words = fallback_text.split(" ")
            for i, w in enumerate(words):
                token = w if i == 0 else " " + w
                answer.append(token)
                yield {"type": "token", "text": token}

    # Small models often group citations: "[1, 2]" -> "[1][2]" so parsing and UI chips see each one
    text = GROUPED_CITE.sub(lambda m: "".join(f"[{n.strip()}]" for n in m.group(1).split(",")), "".join(answer).strip())
    replaced =ungrounded_reason(text, sources) if text != REFUSAL else None
    if replaced:
        text = REFUSAL
    valid = {s["n"]: s for s in sources}
    cited_ns = sorted({int(n) for n in CITE.findall(text) if int(n) in valid})
    attributed = False
    if not cited_ns and sources and not text.startswith("I don't have"):
        text = attribute(text, sources)
        cited_ns = sorted({int(n) for n in CITE.findall(text) if int(n) in valid})
        attributed = bool(cited_ns)
    cited = [valid[n]["memory_id"] for n in cited_ns]
    # State fleet verification from data, not model wording: which cited notes were
    # independently reported by more than one device.
    verified = [valid[n] for n in cited_ns if valid[n].get("fleet_verified")]
    if verified:
        text += " " + " ".join(
            f"[{s['n']}] is fleet verified: reported independently by {len(s['corroborated_by'])} devices "
            f"({', '.join(s['corroborated_by'])})." for s in verified)
    grounded = bool(cited) or text.startswith("I don't have")
    latency = {
        "retrieve": got["ms"],
        "first_token": first_token_ms,
        "total": round((time.perf_counter() - t0) * 1000, 1)
    }

    S.add(session_id, "user", question)
    msg_id = S.add(session_id, "assistant", text, sources=sources, cited=cited, latency=latency)

    # Event carries counts only, never the question or answer text.
    emit("assistant.answered", None, {
        "sources": len(sources),
        "cited": len(cited),
        "grounded": grounded,
        "latency": latency,
        "scope": scope
    })

    yield {
        "type": "done",
        "message_id": msg_id,
        "text": text,              # final text; differs from the stream when citations were attributed
        "attributed": attributed,
        "replaced": replaced,      # why a streamed answer was replaced by the refusal, if it was
        "cited_ns": cited_ns,
        "cited": cited,
        "grounded": grounded,
        "latency_ms": latency
    }
