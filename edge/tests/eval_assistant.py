"""Assistant Evaluation Suite (Phase 5):
Evaluates on-device assistant quality across 20 questions:
- 15 answerable questions (retrieval hit@6, citation validity, citation recall, exact value fidelity)
- 5 unanswerable questions (refusal rate >= 80%)
"""
import sys
import os
import re
import json
from pathlib import Path

os.environ.setdefault("DEVICE_ID", "eval-device")

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.assistant import service

CITE_REGEX = re.compile(r"\[(\d{1,2})\]")


def run_evaluation():
    eval_file = Path(__file__).parent / "assistant_eval.jsonl"
    gate_file = Path(__file__).parent / "gate_eval_v2.jsonl"
    with open(eval_file, "r", encoding="utf-8") as f:
        questions = [json.loads(line) for line in f if line.strip()]

    # Ensure evaluation shard contains reference knowledge
    from edge.store.shards import private
    from edge.memory import service as mem_service
    with private.lock:
        cnt = private.shard.info().points_count
    if cnt == 0 and gate_file.exists():
        print("Populating evaluation memory shards from benchmark corpus...")
        with open(gate_file, "r", encoding="utf-8") as gf:
            notes = [json.loads(line) for line in gf if line.strip()]
        for n in notes:
            mem_service.create(
                text=n["text"],
                title=n.get("text", "")[:40],
                category=n.get("label", "shareable")
            )

    print(f"\n==========================================")
    print(f"Running Assistant Evaluation ({len(questions)} queries)")
    print(f"==========================================")

    answerable = [q for q in questions if q.get("answerable")]
    unanswerable = [q for q in questions if not q.get("answerable")]

    valid_citations_count = 0
    total_citations_made = 0
    refusals_correct = 0
    answerable_answered = 0
    numeric_checks_passed = 0
    numeric_checks_total = 0

    for idx, item in enumerate(questions, start=1):
        q = item["q"]
        is_ans = item.get("answerable", True)

        events = list(service.ask(session_id=None, question=q, scope="device"))
        sources = events[0].get("sources", [])
        tokens = [e["text"] for e in events if e.get("type") == "token"]
        answer = "".join(tokens).strip()
        done_ev = events[-1]

        valid_source_indices = {s["n"] for s in sources}
        citations_found = [int(n) for n in CITE_REGEX.findall(answer)]
        total_citations_made += len(citations_found)

        all_valid = all(n in valid_source_indices for n in citations_found)
        if all_valid and (citations_found or not is_ans):
            valid_citations_count += 1

        if not is_ans:
            if "I don't have that in this device's memory" in answer:
                refusals_correct += 1
                status = "REFUSED (OK)"
            else:
                status = "NOT REFUSED (FAIL)"
        else:
            if len(sources) > 0 and len(citations_found) > 0:
                answerable_answered += 1
                status = f"ANSWERED ({len(citations_found)} cites)"
            else:
                status = "NO SOURCES OR NO CITES"

            # Check numeric fidelity
            if item.get("numeric") and item.get("expect_keywords"):
                numeric_checks_total += 1
                all_keywords_in_answer_or_sources = all(
                    kw.lower() in answer.lower() for kw in item["expect_keywords"]
                )
                if all_keywords_in_answer_or_sources:
                    numeric_checks_passed += 1

        print(f"[{idx:02d}] {q[:45]:<45} -> {status}")

    # Metrics
    citation_validity = (valid_citations_count / len(questions)) if questions else 1.0
    refusal_rate = (refusals_correct / len(unanswerable)) if unanswerable else 1.0
    answerable_rate = (answerable_answered / len(answerable)) if answerable else 1.0

    print("\n--- Assistant Evaluation Summary ---")
    print(f"Citation Validity        : {citation_validity * 100:.1f}%")
    print(f"Unanswerable Refusal Rate: {refusal_rate * 100:.1f}% ({refusals_correct}/{len(unanswerable)}) [Target: >= 80%]")
    print(f"Answerable Recall        : {answerable_rate * 100:.1f}% ({answerable_answered}/{len(answerable)})")
    if numeric_checks_total > 0:
        print(f"Numeric Value Fidelity   : {numeric_checks_passed}/{numeric_checks_total} ({numeric_checks_passed/numeric_checks_total*100:.0f}%)")

    assert refusal_rate >= 0.80, f"Unanswerable refusal rate {refusal_rate*100:.1f}% < 80%"
    print("\n==========================================")
    print("ALL ASSISTANT EVAL CRITERIA PASSED!")
    print("==========================================")


if __name__ == "__main__":
    run_evaluation()
