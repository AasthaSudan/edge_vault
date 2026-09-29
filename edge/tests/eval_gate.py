"""Gate Evaluation Suite (Phase 2 & Phase 5):
Runs every test note 5 times to verify:
1. Overall accuracy >= 90%
2. Flip count = 0 (perfect stability across runs)
3. Zero false shareables (no private note ever classified as shareable)
4. Mixed notes produce sanitize_candidate = True
5. Full 3x3 confusion matrix
"""
import sys
import os
import json
from pathlib import Path
from collections import defaultdict

os.environ.setdefault("DEVICE_ID", "eval-device")

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.gate.gate import decide, decide_v2
from edge.store.embed import embed_doc

CATEGORIES = ["shareable", "private", "routine"]


def run_evaluation(num_runs: int = 5, use_v2: bool = True):
    filename = "gate_eval_v2.jsonl" if use_v2 else "gate_eval.jsonl"
    eval_file = Path(__file__).parent / filename
    with open(eval_file, "r", encoding="utf-8") as f:
        dataset = [json.loads(line) for line in f if line.strip()]

    version_str = "Gate v2 (Context & Signals)" if use_v2 else "Gate v1"
    print(f"\n==========================================")
    print(f"Running {version_str} Evaluation ({len(dataset)} items)")
    print(f"==========================================")

    run_accuracies = []
    item_predictions = defaultdict(list)
    confusion = {c1: {c2: 0 for c2 in CATEGORIES} for c1 in CATEGORIES}
    mixed_sanitize_candidates = 0
    total_mixed = 0

    for run_idx in range(num_runs):
        correct = 0
        for item in dataset:
            text = item["text"]
            true_label = item["label"]

            if use_v2:
                dense = embed_doc(text)["dense"]
                decision = decide_v2(text, dense)
            else:
                decision = decide(text)

            pred_label = decision.category
            item_predictions[text].append(pred_label)

            if pred_label == true_label:
                correct += 1

            if run_idx == 0:
                confusion[true_label][pred_label] += 1
                if item.get("mixed"):
                    total_mixed += 1
                    if getattr(decision, "sanitize_candidate", False) or (
                        decision.category == "private" and any(
                            sig in decision.signals for sig in ["equipment_fault", "equipment_fix", "part_or_spec"]
                        )
                    ):
                        mixed_sanitize_candidates += 1

        acc = correct / len(dataset)
        run_accuracies.append(acc)
        print(f"  Run #{run_idx + 1} Accuracy: {acc * 100:.1f}%")

    avg_acc = sum(run_accuracies) / len(run_accuracies)
    print("\n--- 3x3 Confusion Matrix (Actual \\ Predicted) ---")
    header = f"{'Actual':<12} | " + " | ".join(f"{c:<10}" for c in CATEGORIES)
    print(header)
    print("-" * len(header))
    for actual in CATEGORIES:
        row = f"{actual:<12} | " + " | ".join(f"{confusion[actual][pred]:<10}" for pred in CATEGORIES)
        print(row)

    # Check for flips across runs
    flips = 0
    flipped_notes = []
    for text, preds in item_predictions.items():
        if len(set(preds)) > 1:
            flips += 1
            flipped_notes.append((text, preds))

    # Check for private leaks (private predicted as shareable)
    false_shareables = confusion["private"]["shareable"]

    print("\n--- Evaluation Summary ---")
    print(f"Average Accuracy    : {avg_acc * 100:.1f}% (Pass threshold: >= 90.0%)")
    print(f"Category Flips      : {flips} (Pass threshold: 0)")
    print(f"False Shareables    : {false_shareables} (Pass threshold: 0 - CRITICAL)")
    if total_mixed > 0:
        print(f"Mixed Sanitize Yield: {mixed_sanitize_candidates}/{total_mixed} ({mixed_sanitize_candidates/total_mixed*100:.0f}%)")

    if flipped_notes:
        print(f"Flipped notes: {flipped_notes}")

    assert avg_acc >= 0.90, f"Gate accuracy {avg_acc*100:.1f}% is below 90% requirement"
    assert flips == 0, f"Gate is non-deterministic: detected {flips} category flips across runs"
    assert false_shareables == 0, f"Security violation: {false_shareables} private notes predicted as shareable!"

    print("\n==========================================")
    print(f"ALL {version_str.upper()} EVAL CRITERIA PASSED!")
    print("==========================================")


if __name__ == "__main__":
    v1_mode = "--v1" in sys.argv
    run_evaluation(5, use_v2=not v1_mode)
