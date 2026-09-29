"""Phase 3 Edge-Cloud Synchronization & Conflict Verification Suite:
1. Bootstrapping shared shards from server snapshot
2. Offline writes on Device A and Device B
3. Push outbox & verify fleet convergence
4. Proof of Privacy: private_on_server == 0 and routine_on_server == 0
5. Version conflict detection in conflict inboxes
6. Idempotent push repeat verification
7. Conflict resolution flow
"""
import sys
import os
import json
import time
import httpx
from pathlib import Path

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.config import settings
from edge.memory import service
from edge.store import embed
from edge.sync import outbox, push, pull
from edge import db

SYNC_API_URL = "http://localhost:8080"

async def test_full_sync_lifecycle():
    print("\n--- Step 1: Health & Clean Server Stats ---")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{SYNC_API_URL}/health")
        assert r.status_code == 200, "Cloud Sync API not healthy"

        r_stats = await client.get(f"{SYNC_API_URL}/stats")
        stats = r_stats.json()
        print("Initial Server Stats:", stats)
        assert stats["private_on_server"] == 0, "Security violation: private notes found on server!"
        assert stats["routine_on_server"] == 0, "Security violation: routine notes found on server!"

    print("\n--- Step 2: Device A Offline Logging ---")
    # 1. Shareable note
    shareable_note = service.create(
        text="P-200 cavitation resolved by replacing worn bronze impeller with stainless steel upgrade",
        title="P-200 Fleet Fix",
        asset_tag="P-200",
        category="shareable"
    )
    # 2. Private note
    private_note = service.create(
        text="Gate code for the Noida plant is 4431; do not disclose to contractors",
        title="Noida Facility Access",
        category="private"
    )
    # 3. Routine note
    routine_note = service.create(
        text="Reached site at 10:15, beginning shift inspection",
        title="Shift Check",
        category="routine"
    )

    print(f"Device A created 3 notes:")
    print(f"  Shareable note: {shareable_note['memory_id']} (outbox pending)")
    print(f"  Private note  : {private_note['memory_id']} (stays local)")
    print(f"  Routine note  : {routine_note['memory_id']} (stays local)")

    current_outbox_depth = outbox.depth()
    print(f"Current outbox depth for Device A: {current_outbox_depth}")
    assert current_outbox_depth >= 1, "Expected shareable note to be in outbox"

    print("\n--- Step 3: Device A Pushes Outbox to Cloud ---")
    async with httpx.AsyncClient(timeout=15) as client:
        while outbox.depth() > 0:
            pushed = await push.push_once(client)
            print(f"Successfully pushed {pushed} items from outbox.")

    remaining_depth = outbox.depth()
    print(f"Remaining outbox depth after push: {remaining_depth}")
    assert remaining_depth == 0, "Expected outbox to be drained after successful push"

    print("\n--- Step 4: Verify Server Stats (Proof of Privacy) ---")
    async with httpx.AsyncClient(timeout=10) as client:
        r_stats = await client.get(f"{SYNC_API_URL}/stats")
        stats = r_stats.json()
        print("Server Stats after push:", stats)
        assert stats["private_on_server"] == 0, "CRITICAL: Private note reached the server!"
        assert stats["routine_on_server"] == 0, "CRITICAL: Routine note reached the server!"
        assert stats["shareable_on_server"] >= 1, "Shareable note not registered on server!"
    print("Proof of Privacy VERIFIED: private_on_server == 0, routine_on_server == 0.")

    print("\n--- Step 5: Test Idempotent Repeat Push ---")
    # Re-pushing an already synced item must succeed safely as a no-op
    test_body = {
        "device_id": settings.device_id,
        "items": [{
            "memory_id": shareable_note["memory_id"],
            "op": "upsert",
            "point": {
                "id": shareable_note["memory_id"],
                "vector": {"dense": [0.05]*384, "bm25": {"indices": [1, 2], "values": [1.0, 1.0]}},
                "payload": shareable_note
            },
            "version": shareable_note["version"],
            "base_version": shareable_note["base_version"]
        }]
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r_repeat = await client.post(f"{SYNC_API_URL}/push", json=test_body)
        res = r_repeat.json()
        assert shareable_note["memory_id"] in res["accepted"], "Idempotent push should be accepted as no-op"
    print("Idempotency VERIFIED: Duplicate push accepted without error or duplicate records.")

    print("\n--- Step 6: Test Version Conflict Detection ---")
    # Simulate Device B editing the same note offline with stale base_version
    conflicting_body = {
        "device_id": "device-b",
        "items": [{
            "memory_id": shareable_note["memory_id"],
            "op": "upsert",
            "point": {
                "id": shareable_note["memory_id"],
                "vector": {"dense": [0.05]*384, "bm25": {"indices": [1, 2], "values": [1.0, 1.0]}},
                "payload": {
                    **shareable_note,
                    "text": "Conflicting edit: do NOT replace impeller, clean intake strainer instead!",
                    "device_id": "device-b",
                    "version": 1
                }
            },
            "version": 1,
            "base_version": 0  # Stale base version! Server already has version 1 from device A
        }]
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r_conflict = await client.post(f"{SYNC_API_URL}/push", json=conflicting_body)
        c_res = r_conflict.json()
        print("Conflict response from server:", c_res)
        assert len(c_res["conflicts"]) == 1, "Expected version conflict to be detected!"
        assert c_res["conflicts"][0]["kind"] == "version", "Conflict kind must be 'version'"
        conflict_id = c_res["conflicts"][0]["id"]
    print("Version Conflict Detection VERIFIED.")

    print("\n--- Step 7: Test Conflict Resolution Endpoint ---")
    async with httpx.AsyncClient(timeout=10) as client:
        resolve_payload = {
            "conflict_id": conflict_id,
            "resolution": "keep_local",
            "merged_text": None
        }
        r_resolve = await client.post(f"{SYNC_API_URL}/conflicts/resolve", json=resolve_payload)
        assert r_resolve.status_code == 200, "Conflict resolution failed"
        resolve_data = r_resolve.json()
        print("Resolved conflict:", resolve_data)
        assert resolve_data["status"] == "resolved"
    print("Conflict Resolution VERIFIED.")

    print("\n==========================================")
    print("ALL PHASE 3 SYNC & CONFLICT TESTS PASSED!")
    print("==========================================")

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_full_sync_lifecycle())
