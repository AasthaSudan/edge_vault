"""Edge-Cloud Synchronization & Conflict Verification Suite:
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

SYNC_API_URL = settings.sync_api_url  # same cloud the edge sync code talks to


def _wire_item(device, tag, text, version=1, base=0, op="upsert", mid=None, category="shareable"):
    """A push item with a REAL embedding, as an edge device would send it."""
    import uuid as _uuid
    mid = mid or str(_uuid.uuid4())
    vec = embed.embed_doc(text)
    now = int(time.time() * 1000)
    pl = {"memory_id": mid, "text": text, "title": "", "asset_tag": tag, "category": category, "device_id": device,
          "version": version, "base_version": base, "deleted": False, "created_at": now, "updated_at": now}
    return mid, {"memory_id": mid, "op": op, "version": version, "base_version": base,
                 "point": {"id": mid, "payload": pl,
                           "vector": {"dense": vec["dense"],
                                      "bm25": {"indices": list(vec["bm25"].indices), "values": list(vec["bm25"].values)}}}}


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

    print("\n--- Step 8: Edits carry the correct base_version ---")
    mid = shareable_note["memory_id"]
    server_version = resolve_data["version"]
    # a) Edit on top of the resolved server version is accepted without a conflict
    edited = service.update(mid, text="P-200 cavitation: replace impeller; stainless steel upgrade preferred", server_version=server_version)
    assert edited["base_version"] == server_version and edited["version"] == server_version + 1
    async with httpx.AsyncClient(timeout=15) as client:
        while outbox.depth() > 0:
            await push.push_once(client)
        conflicts_before = db.execute("SELECT COUNT(*) FROM conflicts").fetchone()[0]

        # b) Device B edits the cloud copy first, then Device A edits its stale local copy
        pb = {**edited, "text": "Device B: impeller fine, clean the strainer", "device_id": "device-b",
              "version": edited["version"] + 1, "base_version": edited["version"]}
        r_b = await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-b", "items": [{
            "memory_id": mid, "op": "upsert",
            "point": {"id": mid, "vector": {"dense": [0.05] * 384, "bm25": {"indices": [1], "values": [1.0]}}, "payload": pb},
            "version": pb["version"], "base_version": pb["base_version"]}]})
        assert mid in r_b.json()["accepted"]

        stale = service.update(mid, text="Device A: stale offline edit")
        assert stale["base_version"] == edited["version"], "base_version must be the version the edit started from"
        while outbox.depth() > 0:
            await push.push_once(client)
        conflicts_after = db.execute("SELECT COUNT(*) FROM conflicts").fetchone()[0]
    assert conflicts_after == conflicts_before + 1, "A stale edit must be detected as a version conflict, not overwrite"
    print("Edit versioning VERIFIED: fresh edit accepted, stale edit raised a conflict.")

    print("\n--- Step 9: Pull uses the server clock (offline edit with an old timestamp) ---")
    async with httpx.AsyncClient(timeout=15) as client:
        assert await pull.pull_once(client), "Initial pull failed"
        # Device C edited offline long ago (updated_at in 1970) and only now reconnects
        old_id = str(__import__("uuid").uuid4())
        old_pl = {"memory_id": old_id, "text": "C-14 compressor trips when intake filter clogs; clean filter.",
                  "title": "C-14 trip", "asset_tag": "C-14", "category": "shareable", "device_id": "device-c",
                  "version": 1, "base_version": 0, "created_at": 1, "updated_at": 1, "deleted": False}
        await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-c", "items": [{
            "memory_id": old_id, "op": "upsert",
            "point": {"id": old_id, "vector": {"dense": [0.03] * 384, "bm25": {"indices": [3], "values": [1.0]}}, "payload": old_pl},
            "version": 1, "base_version": 0}]})
        assert await pull.pull_once(client), "Delta pull failed"
    from edge.store.shards import shared
    with shared.lock:
        got = shared.shard.retrieve([old_id], True, False)
    assert got, "Record with an old device timestamp was not delivered by the delta pull"
    print("Server-clock pull VERIFIED: offline edit with an old updated_at was delivered.")

    print("\n--- Step 10: Cross-device corroboration (Fleet Verified) ---")
    import random, uuid
    from qdrant_client import QdrantClient
    tag = f"P-{random.randint(100, 999)}"
    qc = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
    # a) This device reports a fix
    mine = service.create(text=f"Pump {tag} seal leak fixed by replacing the mechanical seal with a Viton seal.",
                          asset_tag=tag, category="shareable", dedup=False)

    def raw_push(device, text):
        mid = str(uuid.uuid4())
        vec = embed.embed_doc(text)
        pl = {"memory_id": mid, "text": text, "title": "", "asset_tag": tag, "category": "shareable",
              "device_id": device, "version": 1, "base_version": 0, "deleted": False,
              "created_at": int(time.time() * 1000), "updated_at": int(time.time() * 1000)}
        body = {"device_id": device, "items": [{"memory_id": mid, "op": "upsert", "version": 1, "base_version": 0,
                "point": {"id": mid, "payload": pl, "vector": {"dense": vec["dense"],
                          "bm25": {"indices": list(vec["bm25"].indices), "values": list(vec["bm25"].values)}}}}]}
        return mid, body

    async with httpx.AsyncClient(timeout=15) as client:
        while outbox.depth() > 0:
            await push.push_once(client)
        # b) An independent device reports the same fact in its own words
        b_id, b_body = raw_push("device-y", f"Replaced the mechanical seal on pump {tag} with a Viton seal to fix the leak.")
        await client.post(f"{SYNC_API_URL}/push", json=b_body)
        # c) A third device reports the same topic with a different value: not corroboration
        c_id, c_body = raw_push("device-z", f"Pump {tag} seal leak fixed by replacing the mechanical seal; set flow to 45 GPM.")
        await client.post(f"{SYNC_API_URL}/push", json=c_body)
        assert await pull.pull_once(client)

    srv = {str(p.id): p.payload for p in qc.retrieve("shared_memory", ids=[mine["memory_id"], b_id, c_id], with_payload=True)}
    assert srv[mine["memory_id"]]["fleet_verified"] and srv[b_id]["fleet_verified"], srv
    assert set(srv[b_id]["corroborated_by"]) == {settings.device_id, "device-y"}
    assert not srv[c_id].get("fleet_verified"), "A report with different values must not count as corroboration"
    from edge.store.shards import shared as shared_shard
    with shared_shard.lock:
        local = shared_shard.shard.retrieve([mine["memory_id"]], True, False)[0].payload
    assert local.get("fleet_verified") and local.get("corroboration_count") == 2, local
    print(f"Corroboration VERIFIED: {tag} fix verified by {srv[b_id]['corroborated_by']}; "
          "differing-value report not counted; this device's own copy updated on pull.")

    print("\n--- Step 11: Another device's edit at the same version is a conflict, not a retry ---")
    note = service.create(text=f"Relief valve V-{random.randint(100, 999)} set pressure is 10 bar.",
                          category="shareable", dedup=False)
    async with httpx.AsyncClient(timeout=15) as client:
        while outbox.depth() > 0:
            await push.push_once(client)
        # Same author field, version and base as the server copy, different text: before the fix
        # the server treated this as an idempotent retry and silently dropped the edit.
        other = {**note, "text": note["text"].replace("10 bar", "12 bar"), "version": 1, "base_version": 0}
        r = await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-q", "items": [{
            "memory_id": note["memory_id"], "op": "upsert", "version": 1, "base_version": 0,
            "point": {"id": note["memory_id"], "payload": other,
                      "vector": {"dense": [0.02] * 384, "bm25": {"indices": [1], "values": [1.0]}}}}]})
        res = r.json()
    assert res["conflicts"] and res["conflicts"][0]["kind"] == "version", res
    assert note["memory_id"] not in res["accepted"]
    print("Same-version edit VERIFIED: a different device's edit raised a version conflict.")

    print("\n--- Step 12: A retraction is stored as an empty tombstone, whatever the client sends ---")
    tag = f"TB-{random.randint(1000, 9999)}"
    mid, item = _wire_item("device-t", tag, f"Secret gate code is 4431 for site {tag}.", category="private", op="delete")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-t", "items": [item]})
        assert r.status_code == 200 and mid in r.json()["accepted"], r.text
        stats = (await client.get(f"{SYNC_API_URL}/stats")).json()
        # a non-delete private push must still be refused
        _, private_item = _wire_item("device-t", tag, "private thing", category="private")
        r_priv = await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-t", "items": [private_item]})
    assert stats["private_on_server"] == 0, "a private note was stored through op=delete"
    assert r_priv.status_code == 400, "the category guard must still refuse private upserts"
    stored = qc.retrieve("shared_memory", ids=[mid], with_payload=True, with_vectors=True)[0]
    assert stored.payload["text"] == "" and stored.payload["title"] == "" and stored.payload["deleted"] is True, stored.payload
    assert stored.payload["category"] == "shareable"
    assert len({round(x, 6) for x in stored.vector["dense"]}) == 1, "the tombstone still carries the note's embedding"
    print("Tombstone VERIFIED: content, category and vector are blanked by the server; private upserts still refused.")

    print("\n--- Step 13: A follow-up edit cannot overwrite the other device's edit ---")
    tag = f"FU-{random.randint(1000, 9999)}"
    mid, first = _wire_item("dev-a1", tag, f"Pump {tag} seal replaced with a Viton seal.")
    b_text = f"Pump {tag} seal replaced; also cleaned the suction strainer."
    a_newest = f"Pump {tag} seal replaced, then re-torqued the gland bolts."
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{SYNC_API_URL}/push", json={"device_id": "dev-a1", "items": [first]})
        _, b_edit = _wire_item("dev-b1", tag, b_text, version=2, base=1, mid=mid)   # B edits first and syncs
        rb = await client.post(f"{SYNC_API_URL}/push", json={"device_id": "dev-b1", "items": [b_edit]})
        assert mid in rb.json()["accepted"]
        # A edited twice offline: v2 (based on 1), then v3 (based on its own v2). Before the fix the
        # second edit passed the version check ("2 > 2" is false) and silently overwrote B's edit.
        _, a2 = _wire_item("dev-a1", tag, f"Pump {tag} seal replaced (A, first edit).", version=2, base=1, mid=mid)
        _, a3 = _wire_item("dev-a1", tag, a_newest, version=3, base=2, mid=mid)
        res = (await client.post(f"{SYNC_API_URL}/push", json={"device_id": "dev-a1", "items": [a2, a3]})).json()
        assert res["accepted"] == [], res
        assert len(res["conflicts"]) == 1 and res["conflicts"][0]["kind"] == "version", res
        assert res["conflicts"][0]["local"]["text"] == a_newest, "the newest edit must be the conflict's local side"
        assert qc.retrieve("shared_memory", ids=[mid], with_payload=True)[0].payload["text"] == b_text, "B's edit was overwritten"
        # a later retry of the same follow-up returns the SAME conflict instead of opening another
        again = (await client.post(f"{SYNC_API_URL}/push", json={"device_id": "dev-a1", "items": [a3]})).json()
        assert [c["id"] for c in again["conflicts"]] == [res["conflicts"][0]["id"]], again
        # keeping the local side now keeps A's newest text, not the older rejected one
        rr = await client.post(f"{SYNC_API_URL}/conflicts/resolve",
                               json={"conflict_id": res["conflicts"][0]["id"], "resolution": "keep_local"})
        assert rr.status_code == 200, rr.text
        assert qc.retrieve("shared_memory", ids=[mid], with_payload=True)[0].payload["text"] == a_newest
        # an invalid resolution is rejected instead of being treated as "merged"
        bad = await client.post(f"{SYNC_API_URL}/conflicts/resolve", json={"conflict_id": "x", "resolution": "whatever"})
        assert bad.status_code == 422
    print("Lost-update guard VERIFIED: B's edit survived, A's newest edit became the conflict's local side.")

    print("\n--- Step 14: Contradicting reports are flagged; unrelated, agreeing or merely differently-timed ones are not ---")
    cases = [
        ("differing value", "Relief valve {t} set pressure is 10 bar.", "Relief valve {t} set pressure is 12 bar.", True),
        ("differing torque", "Flange bolts on {t} torque to 25 Nm.", "Flange bolts on {t} torque to 20 Nm.", True),
        ("opposite instruction", "Keep isolation valve on {t} open during start-up.", "Keep isolation valve on {t} closed during start-up.", True),
        ("different fixes", "Replaced worn bearing on {t} and noted this in the log.", "Cleaned the strainer on {t}; another note is on the list.", False),
        ("same fact reworded", "Replaced the mechanical seal on {t} to stop the leak.", "Mechanical seal on {t} was replaced and the leak stopped.", False),
        ("only the time differs", "Inspected {t} at 10:15, all normal.", "Inspected {t} at 14:30, all normal.", False),
    ]
    async with httpx.AsyncClient(timeout=30) as client:
        for label, a, b, expect in cases:
            t = f"TC-{random.randint(1000, 9999)}"
            _, ia = _wire_item("device-p", t, a.format(t=t))
            _, ib = _wire_item("device-q", t, b.format(t=t))
            await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-p", "items": [ia]})
            res = (await client.post(f"{SYNC_API_URL}/push", json={"device_id": "device-q", "items": [ib]})).json()
            got = "contradiction" in [c["kind"] for c in res["conflicts"]]
            assert got == expect, f"{label}: expected contradiction={expect}, server said {res['conflicts']}"
    print("Contradiction detection VERIFIED: real contradictions flagged, benign pairs left alone.")

    print("\n==========================================")
    print("ALL SYNC & CONFLICT TESTS PASSED!")
    print("==========================================")

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_full_sync_lifecycle())
