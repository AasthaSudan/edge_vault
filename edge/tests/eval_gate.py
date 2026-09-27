"""Gate Evaluation Suite (Phase 2):
Runs every test note 5 times to verify:
1. Overall accuracy >= 90%
2. Flip count = 0 (perfect stability across runs)
3. Zero false shareables (no private note ever classified as shareable)
4. Full 3x3 confusion matrix
"""
import sys
import json
from pathlib import Path
from collections import defaultdict

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.gate.gate import decide

CATEGORIES = ["shareable", "private", "routine"]

def run_evaluation(num_runs: int = 5):
    eval_file = Path(__file__).parent / "gate_eval.jsonl"
    with open(eval_file, "r", encoding="utf-8") as f:
        dataset = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(dataset)} labeled evaluation notes.")
    print(f"Running evaluation across {num_runs} consecutive runs...")

    run_accuracies = []
    item_predictions = defaultdict(list)
    confusion = {c1: {c2: 0 for c2 in CATEGORIES} for c1 in CATEGORIES}

    for run_idx in range(num_runs):
        correct = 0
        for item in dataset:
            text = item["text"]
            true_label = item["label"]

            decision = decide(text)
            pred_label = decision.category
            item_predictions[text].append(pred_label)

            if pred_label == true_label:
                correct += 1

            if run_idx == 0:
                confusion[true_label][pred_label] += 1

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
    print(f"False Shareables    : {false_shareables} (Pass threshold: 0)")

    if flipped_notes:
        print(f"Flipped notes: {flipped_notes}")

    assert avg_acc >= 0.90, f"Gate accuracy {avg_acc*100:.1f}% is below 90% requirement"
    assert flips == 0, f"Gate is non-deterministic: detected {flips} category flips across runs"
    assert false_shareables == 0, f"Security violation: {false_shareables} private notes predicted as shareable!"

    print("\n==========================================")
    print("ALL PHASE 2 GATE EVAL CRITERIA PASSED!")
    print("==========================================")

if __name__ == "__main__":
    run_evaluation(5)
