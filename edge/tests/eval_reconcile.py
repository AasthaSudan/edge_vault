"""Conflict reconciliation eval: does the on-device LLM tell a progression over time from a
genuine contradiction and from the same fact reworded? Needs Ollama running.

Usage: PYTHONPATH=edge python edge/tests/eval_reconcile.py
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("DEVICE_ID", "reconcile-eval")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.assistant.reconcile import analyze

D = 86_400_000
MON = 1790000000000


def rep(dev, tag, text, day):
    return {"device_id": dev, "asset_tag": tag, "text": text, "updated_at": MON + day * D}


CASES = [
    ("progression", rep("device-a", "C-14", "C-14 compressor running normally, discharge temp 78C.", 0),
                    rep("device-b", "C-14", "C-14 compressor tripped on high temp 104C, intake filter clogged.", 2)),
    ("progression", rep("device-a", "TK-10", "TK-10 weld seams inspected, no cracks found.", 0),
                    rep("device-c", "TK-10", "Hairline crack found on TK-10 bottom weld seam, tank taken out of service.", 6)),
    ("progression", rep("device-a", "P-5", "Pump P-5 vibration 2.1 mm/s, within limits.", 0),
                    rep("device-b", "P-5", "Pump P-5 vibration rose to 7.8 mm/s, bearing noise audible.", 9)),
    ("contradiction", rep("device-a", "B-2", "Torque spec for panel B-2 bus bars is 25 Nm.", 0),
                      rep("device-b", "B-2", "Torque spec for panel B-2 bus bars is 20 Nm.", 1)),
    ("contradiction", rep("device-a", "M-3", "Motor M-3 uses 6205-2RS bearings.", 0),
                      rep("device-b", "M-3", "Motor M-3 uses 6305 bearings, not 6205.", 1)),
    ("contradiction", rep("device-a", "V-9", "Isolation valve V-9 must be closed before starting pump P-9.", 0),
                      rep("device-c", "V-9", "Keep isolation valve V-9 open when starting pump P-9.", 3)),
    ("same_fact", rep("device-a", "P-200", "P-200 cavitation noise fixed by replacing the worn impeller.", 0),
                  rep("device-b", "P-200", "Replaced worn impeller on P-200; cavitation noise gone.", 1)),
    ("same_fact", rep("device-a", "XF-1", "Replaced blown 15A fuse on XF-1 with fast-acting type.", 0),
                  rep("device-b", "XF-1", "XF-1 control transformer: blown 15A fuse swapped for a fast-acting one.", 1)),
]

if __name__ == "__main__":
    ok, ms = 0, []
    for want, local, remote in CASES:
        a = analyze(local, remote)
        ok += a["relation"] == want
        ms.append(a["ms"])
        print(f"[{'OK' if a['relation'] == want else 'XX'}] {want:<13} -> {a['relation']:<13} "
              f"{a['recommendation']:<11} ({a['source']}, {a['ms']} ms)\n     {a['explanation']}")
    ms.sort()
    print(f"\n{ok}/{len(CASES)} correct · median {ms[len(ms) // 2]} ms")
    assert ok / len(CASES) >= 0.75, "Reconciliation accuracy below 75%"
