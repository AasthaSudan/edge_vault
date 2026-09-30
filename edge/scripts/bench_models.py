"""Usage: python edge/scripts/bench_models.py qwen2.5:1.5b gemma3:1b llama3.2:1b
Benchmarks small local models for:
1. Accuracy on gate_eval_v2.jsonl
2. False shareables count (must be 0)
3. Flip count across runs (must be 0)
4. p50 and p95 latency on CPU
"""
import json
import sys
import time
import statistics
import os
from pathlib import Path

# Add edge package root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def run(model: str) -> dict:
    os.environ["OLLAMA_MODEL"] = model
    import importlib
    from edge import config
    importlib.reload(config)
    from edge.llm import client as llm
    importlib.reload(llm)
    from edge.gate import gate
    importlib.reload(gate)
    from edge.store.embed import embed_doc

    llm.warmup()
    eval_path = Path(__file__).resolve().parent.parent / "evals" / "gate_eval_v2.jsonl"
    with open(eval_path, "r", encoding="utf-8") as f:
        items = [json.loads(line) for line in f if line.strip()]

    runs, lat, sources = [], [], {}
    for run_idx in range(5):
        preds = []
        for it in items:
            t0 = time.perf_counter()
            d = gate.decide_v2(it["text"], embed_doc(it["text"])["dense"])
            lat.append((time.perf_counter() - t0) * 1000)
            preds.append(d.category)
            sources[d.source] = sources.get(d.source, 0) + 1
        runs.append(preds)

    labels = [it["label"] for it in items]
    acc = statistics.mean(p == l for p, l in zip(runs[0], labels))
    false_share = sum(p == "shareable" and l != "shareable" for p, l in zip(runs[0], labels))
    flips = sum(len({r[i] for r in runs}) > 1 for i in range(len(items)))
    lat.sort()
    p50 = round(lat[len(lat) // 2]) if lat else 0
    p95 = round(lat[int(len(lat) * 0.95) - 1]) if lat else 0

    return {
        "model": model,
        "accuracy": round(acc, 3),
        "false_shareables": false_share,
        "flips": flips,
        "decided_by": sources,
        "p50_ms": p50,
        "p95_ms": p95,
        "loaded": llm.loaded_models(),
    }


if __name__ == "__main__":
    models = sys.argv[1:] if len(sys.argv) > 1 else ["qwen2.5:1.5b"]
    for m in models:
        print(f"Benchmarking model: {m}...")
        res = run(m)
        print(json.dumps(res, indent=2))
