"""Stage the live-demo story on two clean edge nodes, then rehearse the key question.

Story: Ravi (Device A) is underground with a vibrating pump. Six months ago a technician
at another plant (Device B) solved the same problem. This script creates everything the
demo shows that should already exist before the judges arrive:

  1. Device B's past fix (P-101 cavitation, "gravel-like noise"), synced to the fleet
  2. A Fleet Verified pair: both devices independently reported the same C-88 fix
  3. A conflict on Device A (V-14 relief valve: 12 bar vs 10 bar), pre-analysed by the AI
  4. A rehearsal of Ravi's question on Device A (also warms the model up)

It does NOT create the notes you type live (the mixed gate-code note, the routine note).

Usage (all services running, devices freshly reset):
  PYTHONPATH=edge python edge/scripts/stage_story.py
  PYTHONPATH=edge python edge/scripts/stage_story.py --a http://127.0.0.1:7001 --b http://127.0.0.1:7002 --cloud http://127.0.0.1:8080
"""
import argparse
import json
import sys
import time

import httpx

QUESTION = "Why is this pump vibrating and making a gravel-like noise?"

STORY_NOTE = {  # written by Device B, "six months ago, at another plant"
    "title": "P-101 gravel-like noise: cavitation",
    "asset_tag": "P-101",
    "text": ("P-101 centrifugal pump at the Pune plant had heavy vibration, a gravel-like noise and falling "
             "discharge pressure. Cause was cavitation from a blocked suction filter. Fix: cleaned the suction "
             "filter, checked suction pressure and inspected the mechanical seal for damage."),
}
VERIFIED_A = {"asset_tag": "C-88", "title": "C-88 high temperature trip",
              "text": "Compressor C-88 tripped on high temperature; cleaning the clogged intake filter fixed it."}
VERIFIED_B = {"asset_tag": "C-88", "title": "C-88 trip fix",
              "text": "C-88 compressor high-temperature trip fixed by cleaning the blocked intake filter."}
CONFLICT_BASE = {"asset_tag": "V-14", "title": "V-14 relief valve setting",
                 "text": "Relief valve V-14 set pressure is 10 bar."}


def step(msg: str) -> None:
    print(f"\n== {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="http://127.0.0.1:7001", help="Device A (Ravi) edge API")
    ap.add_argument("--b", default="http://127.0.0.1:7002", help="Device B (other plant) edge API")
    ap.add_argument("--cloud", default="http://127.0.0.1:8080")
    args = ap.parse_args()
    A, B, CLOUD = args.a, args.b, args.cloud
    c = httpx.Client(timeout=120)

    def sync(dev: str) -> None:
        r = c.post(f"{dev}/sync/now").json()
        if r.get("status") != "ok":
            raise SystemExit(f"Sync failed on {dev}: {r}")

    def note(dev: str, body: dict) -> dict:
        r = c.post(f"{dev}/memories", json={**body, "category": "shareable"})
        r.raise_for_status()
        return r.json()

    step("Checking services")
    for name, url in (("Device A", A), ("Device B", B), ("Cloud", CLOUD)):
        h = c.get(f"{url}/health").json()
        ok = h.get("ok", h.get("status") == "ok")
        print(f"  {name:<9} {url}  {'ok' if ok else h}")
        if not ok:
            return 1
    for name, url in (("Device A", A), ("Device B", B)):
        c.post(f"{url}/sync/offline", params={"on": "false"})
    llm = c.get(f"{A}/llm/status").json()
    print(f"  Local AI  {llm.get('model')}  loaded={bool(llm.get('loaded'))}")
    if c.get(f"{A}/memories", params={"limit": 1}).json():
        print("  WARNING: Device A already has notes. For a clean demo, reset the devices first.")

    step("1. Device B's past fix at another plant (the note Ravi will find)")
    story = note(B, STORY_NOTE)
    sync(B)
    sync(A)
    assert c.get(f"{A}/memories/{story['memory_id']}").status_code == 200, "Device A did not receive the story note"
    print(f"  B logged '{STORY_NOTE['title']}' and it reached Device A")

    step("2. Fleet Verified pair (both devices independently fixed C-88)")
    note(A, VERIFIED_A)
    sync(A)
    note(B, VERIFIED_B)
    sync(B)
    sync(A)
    sync(B)
    verified = [m for m in c.get(f"{A}/memories", params={"asset_tag": "C-88"}).json() if m.get("fleet_verified")]
    print(f"  {len(verified)} C-88 notes marked Fleet verified on Device A")

    step("3. Conflict on Device A (V-14: Ravi's offline edit vs the other plant's correction)")
    base = note(B, CONFLICT_BASE)
    mid = base["memory_id"]
    sync(B)
    sync(A)
    c.post(f"{A}/sync/offline", params={"on": "true"})
    c.patch(f"{A}/memories/{mid}", json={"text": "Relief valve V-14 set pressure is 12 bar."})
    c.patch(f"{B}/memories/{mid}", json={"text": "Relief valve V-14 set pressure is 10 bar, confirmed against the nameplate."})
    sync(B)
    c.post(f"{A}/sync/offline", params={"on": "false"})
    sync(A)
    conflicts = [x for x in c.get(f"{A}/conflicts").json() if x["memory_id"] == mid and x["status"] == "open"]
    if not conflicts:
        print("  WARNING: no conflict was recorded on Device A")
    else:
        t0 = time.time()
        a = c.post(f"{A}/conflicts/{conflicts[0]['id']}/analyze").json()
        print(f"  Conflict recorded and analysed in {time.time() - t0:.1f}s: {a['relation']} -> {a['recommendation']}")
        print(f"  \"{a['explanation']}\"")

    step("4. Rehearsing Ravi's question on Device A (also warms the model up)")
    for attempt in (1, 2):
        t0 = time.time()
        with c.stream("POST", f"{A}/assistant/ask", json={"question": QUESTION}) as r:
            events = [json.loads(line) for line in r.iter_lines() if line.strip()]
        done, sources = events[-1], events[0].get("sources", [])
        cited = {s["memory_id"] for s in sources if s["n"] in done.get("cited_ns", [])}
        hit = story["memory_id"] in cited
        print(f"  Attempt {attempt} ({time.time() - t0:.1f}s, first word {done['latency_ms'].get('first_token')} ms): "
              f"{'cites the P-101 fix' if hit else 'did NOT cite the P-101 fix'}")
        print(f"  Answer: {done.get('text')}")
        if hit:
            break

    step("Ready")
    print(f"  Device A dashboard: http://127.0.0.1:3000   Device B dashboard: http://127.0.0.1:3001")
    print(f"  Privacy proof: {CLOUD}/stats -> {c.get(f'{CLOUD}/stats').json()}")
    return 0 if hit else 2


if __name__ == "__main__":
    sys.exit(main())
