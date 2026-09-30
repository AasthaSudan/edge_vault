"""Gate Evaluation Suite (Phase 2 & Phase 5, spec §9.1-9.2).

Runs every note 5 times, twice:
  A. baseline: no technician corrections on the device
  B. with the 5 seeded corrections from gate_corrections_seed.jsonl (on-device learning)

Pass criteria (NFR-12), checked on run B:
  accuracy >= 90%, flips = 0, false shareables = 0
Run A must also have 0 false shareables outside the correction-dependent slice:
the privacy guarantee may not depend on corrections.

Uses its own device dir (gate-eval) so no earlier eval data appears as "similar notes".
"""
import sys
import os
import json
from pathlib import Path
from collections import defaultdict

os.environ["DEVICE_ID"] = os.environ.get("GATE_EVAL_DEVICE", "gate-eval")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge import db
from edge.config import settings
from edge.gate.gate import decide, decide_v2
from edge.store.embed import embed_doc

CATEGORIES = ["shareable", "private", "routine"]
HERE = Path(__file__).parent


def seed_corrections(on: bool) -> int:
    db.execute("DELETE FROM gate_feedback")
    if not on:
        return 0
    rows = [json.loads(l) for l in open(HERE / "gate_corrections_seed.jsonl", encoding="utf-8") if l.strip()]
    for i, r in enumerate(rows):
        db.execute(
            "INSERT INTO gate_feedback(memory_id, text, dense_json, model_category, user_category, ts) VALUES (?,?,?,?,?,?)",
            (f"seed-{i}", r["text"], json.dumps(embed_doc(r["text"])["dense"]), r["model_category"], r["user_category"], i),
        )
    return len(rows)


def run_evaluation(num_runs: int = 5, use_v2: bool = True, corrections: bool = False) -> dict:
    eval_file = HERE / ("gate_eval_v2.jsonl" if use_v2 else "gate_eval.jsonl")
    dataset = [json.loads(line) for line in open(eval_file, encoding="utf-8") if line.strip()]
    n_corr = seed_corrections(corrections) if use_v2 else 0

    label = f"Gate {'v2' if use_v2 else 'v1'} · {settings.ollama_model} · corrections={n_corr}"
    print(f"\n==========================================\n{label} ({len(dataset)} items)\n==========================================")

    item_predictions = defaultdict(list)
    confusion = {c1: {c2: 0 for c2 in CATEGORIES} for c1 in CATEGORIES}
    sources = defaultdict(int)
    accs, mixed_total, mixed_ok = [], 0, 0

    for run_idx in range(num_runs):
        correct = 0
        for item in dataset:
            d = decide_v2(item["text"], embed_doc(item["text"])["dense"]) if use_v2 else decide(item["text"])
            item_predictions[item["text"]].append(d.category)
            correct += d.category == item["label"]
            if run_idx == 0:
                confusion[item["label"]][d.category] += 1
                sources[d.source] += 1
                if item.get("mixed"):
                    mixed_total += 1
                    mixed_ok += bool(getattr(d, "sanitize_candidate", False))
        accs.append(correct / len(dataset))
        print(f"  Run #{run_idx + 1} Accuracy: {accs[-1] * 100:.1f}%")

    print("\n--- 3x3 Confusion Matrix (Actual \\ Predicted) ---")
    header = f"{'Actual':<12} | " + " | ".join(f"{c:<10}" for c in CATEGORIES)
    print(header + "\n" + "-" * len(header))
    for actual in CATEGORIES:
        print(f"{actual:<12} | " + " | ".join(f"{confusion[actual][p]:<10}" for p in CATEGORIES))

    flips = [t for t, p in item_predictions.items() if len(set(p)) > 1]
    first = {t: p[0] for t, p in item_predictions.items()}
    leaks = [i for i in dataset if i["label"] != "shareable" and first[i["text"]] == "shareable"]
    leaks_core = [i for i in leaks if not i.get("correction_dependent")]
    misses = [(i["label"], first[i["text"]], i["text"]) for i in dataset if first[i["text"]] != i["label"]]

    res = {
        "accuracy": sum(accs) / len(accs), "flips": len(flips), "false_shareables": len(leaks),
        "false_shareables_core": len(leaks_core), "decided_by": dict(sources),
        "mixed_yield": f"{mixed_ok}/{mixed_total}",
    }
    print(f"\nAccuracy {res['accuracy'] * 100:.1f}% · flips {res['flips']} · false shareables {res['false_shareables']} "
          f"(outside correction slice: {res['false_shareables_core']}) · mixed->suggestion {res['mixed_yield']} · decided_by {res['decided_by']}")
    for want, got, text in misses:
        print(f"  miss [{want} -> {got}] {text[:90]}")
    return res


if __name__ == "__main__":
    if "--v1" in sys.argv:
        run_evaluation(5, use_v2=False)
        sys.exit(0)

    base = run_evaluation(5, corrections=False)
    learned = run_evaluation(5, corrections=True)
    seed_corrections(False)

    print("\n=========== SUMMARY (spec §9.2) ===========")
    print(f"Gate accuracy {base['accuracy'] * 100:.1f}% -> {learned['accuracy'] * 100:.1f}% with on-device corrections")
    print(f"False shareables {base['false_shareables']} -> {learned['false_shareables']} (baseline outside correction slice: {base['false_shareables_core']})")

    assert "llm" in learned["decided_by"], "The LLM never answered: is Ollama running? (fallback-only numbers are meaningless)"
    assert base["false_shareables_core"] == 0, "Privacy leak without corrections outside the correction-dependent slice"
    assert learned["false_shareables"] == 0, "Security violation: private notes predicted as shareable"
    assert learned["flips"] == 0, "Gate is non-deterministic across runs"
    assert learned["accuracy"] >= 0.90, f"Gate accuracy {learned['accuracy'] * 100:.1f}% is below 90%"
    print("ALL GATE V2 EVAL CRITERIA PASSED")
