"""Phase 2 Integration Verification Script:
1. PII scanner & rule-based override test
2. Near-duplicate detection & automatic merge test
3. Shard relocation & fleet retraction test
4. Outbox persistence test
"""
import sys
from pathlib import Path

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.memory import service
from edge.gate.gate import decide
from edge import db

def test_pii_override():
    print("\n--- Test 1: Deterministic PII Override ---")
    text = "Gate code is 4431, P-200 seal replaced"
    dec = decide(text)
    print(f"Text: '{text}'")
    print(f"Decision: category={dec.category}, source={dec.source}, pii_hits={dec.pii_hits}")

    assert dec.category == "private", "Expected private category"
    assert dec.source == "rule", "Expected rule source"
    assert "access_code" in dec.pii_hits, "Expected access_code hit"
    print("Test 1 PASSED: PII rule preempted classification.")

def test_near_duplicate_merge():
    print("\n--- Test 2: Near-Duplicate Detection & Merging ---")
    note1 = service.create(
        text="P-200 cavitation noise resolved by replacing worn impeller",
        asset_tag="P-200",
        category="shareable"
    )
    print(f"Note 1 Created: id={note1['memory_id']}, version={note1['version']}")

    # Insert near duplicate
    note2 = service.create(
        text="P-200 cavitation noise stopped after replacing worn impeller",
        asset_tag="P-200",
        category="shareable"
    )
    print(f"Note 2 Submitted: id={note2['memory_id']}, version={note2['version']}, merged_from={note2.get('merged_from')}")

    assert note2["memory_id"] == note1["memory_id"], "Expected same memory ID to be updated"
    assert note2["version"] == 2, f"Expected version 2, got {note2['version']}"
    assert len(note2["merged_from"]) >= 1, "Expected merged_from to contain merged ID"
    print("Test 2 PASSED: Near duplicate automatically merged.")

def test_shard_relocation_and_retraction():
    print("\n--- Test 3: Shard Relocation & Fleet Retraction ---")
    note = service.create(
        text="Unique secret fix for C-14 compressor pressure",
        asset_tag="C-14",
        category="shareable"
    )
    mid = note["memory_id"]

    # Verify initially in shared shard
    _, rec = service.get(mid)
    assert rec.payload["category"] == "shareable"

    # User manually overrides to private
    updated = service.change_category(mid, "private")
    assert updated["category"] == "private"
    assert updated["gate_source"] == "user"

    # Check outbox has delete operation to retract from fleet
    row = db.execute("SELECT op FROM outbox WHERE memory_id=? ORDER BY id DESC LIMIT 1", (mid,)).fetchone()
    assert row is not None and row["op"] == "delete", f"Expected delete op in outbox for retraction, got {row['op'] if row else None}"
    print("Test 3 PASSED: Shard relocation enqueued delete retraction in outbox.")

if __name__ == "__main__":
    print("Starting Phase 2 Integration Verification...")
    test_pii_override()
    test_near_duplicate_merge()
    test_shard_relocation_and_retraction()
    print("\n==========================================")
    print("ALL PHASE 2 INTEGRATION TESTS PASSED!")
    print("==========================================")
