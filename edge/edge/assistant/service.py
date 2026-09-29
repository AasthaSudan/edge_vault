import re
import time
from edge.assistant import retrieve as R, prompts as P, sessions as S
from edge.events import emit
from edge.llm import client as llm

CITE = re.compile(r"\[(\d{1,2})\]")
REFUSAL = "I don't have that in this device's memory."


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

    text = "".join(answer).strip()
    valid = {s["n"]: s for s in sources}
    cited_ns = sorted({int(n) for n in CITE.findall(text) if int(n) in valid})
    cited = [valid[n]["memory_id"] for n in cited_ns]
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
        "cited_ns": cited_ns,
        "cited": cited,
        "grounded": grounded,
        "latency_ms": latency
    }
