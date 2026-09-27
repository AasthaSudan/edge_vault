# Phase 4: Dashboard, Observability & Demo Hardening (8–10 Oct)

> **Timeline:** 8–10 Oct  
> **Goal:** Judges can watch every decision happen live: gate verdicts, outbox depth, push/pull streams, conflict diffs, and the server's zero-private-points proof.  
> **Exit Criterion:** Full demo script runs **5 times in a row with zero manual interventions or restarts**; all SSE events appear on the dashboard in **under 1 second**.  
> **Final Event:** 11 Oct Offline Round.

---

## 1. Requirements Covered

| ID | Type | Description | Priority |
|---|---|---|---|
| **FR-18** | Functional | Five-panel unified dashboard: Memory Inspector, Search Playground, Sync Status, Activity Feed, Conflict Inbox. | Must |
| **FR-19** | Functional | Global simulated offline switch in the top bar to demonstrate offline behavior on demand. | Must |
| **FR-20** | Functional | Live server-side privacy proof panel reading `GET /stats` (`private_on_server == 0`). | Must |
| **FR-21** | Functional | On-device voice note transcription using `faster-whisper` (`tiny.en`). | Could |
| **FR-22** | Functional | Fleet-wide overview of memories and sync activity aggregated by device. | Could |
| **NFR-07** | Non-Functional | Eventual convergence displayed in real-time across side-by-side browsers. | Target |
| **NFR-08** | Non-Functional | Full explainability: every gate decision shows an explicit source and one-line reason. | Target |

---

## 2. UI Philosophy & Guidelines

- **Typography & Styling:** Clean, industrial dashboard aesthetics using **Next.js 14 (App Router)**, **Tailwind CSS**, and **shadcn/ui**.
- **Clarity over Flash:** Plain, readable fonts with clear high-contrast hierarchy.
- **Accessible Gate Badges:** Never rely solely on color; include explicit text labels (e.g., `[PRIVATE - Rule: access_code]`, `[SHAREABLE - LLM: Equipment fix]`, `[ROUTINE - Status noise]`).
- **Explainability:** Always display the one-line reason for gate classifications and conflict detections.
- **Reactivity:** Real-time updates via **Server-Sent Events (SSE)**. Invalidates TanStack Query cache automatically whenever `memory.*`, `sync.*`, or `conflict.*` events arrive.

---

## 3. Directory & File Structure (Phase 4 Additions)

```
edgevault/
├── Makefile                        # Unified orchestration (cloud, edge-a, edge-b, ui-a, ui-b)
├── dashboard/                      # Next.js 14 application
│   ├── package.json
│   ├── app/
│   │   ├── layout.tsx              # Root shell with global top-bar and OfflineToggle
│   │   ├── page.tsx                # Overview: device status, stats counters, outbox gauge
│   │   ├── memories/page.tsx       # Inspector: table, filter, editor, retract button
│   │   ├── search/page.tsx         # Playground: side-by-side Hybrid vs Dense vs BM25
│   │   ├── sync/page.tsx           # Sync logs, outbox queue table, server privacy proof
│   │   ├── conflicts/page.tsx      # Inbox: side-by-side diffs, Keep Mine / Theirs / Merge
│   │   └── activity/page.tsx       # Live SSE timeline feed
│   ├── components/
│   │   ├── OfflineToggle.tsx       # Simulated connectivity switch
│   │   ├── GateBadge.tsx           # Accessible categorization tag with reason tooltip
│   │   ├── ServerStatsCard.tsx     # Live proof card polling /stats
│   │   └── ui/                     # shadcn/ui components (table, button, dialog, badge)
│   └── lib/
│       ├── api.ts                  # Edge & Cloud fetch clients
│       └── sse.ts                  # React EventSource hook
└── edge/
    ├── scripts/
    │   └── seed_demo.py            # Rehearsed demo notes for Device A & Device B
    └── edge/
        └── api/
            ├── stream.py           # SSE endpoint GET /events
            ├── sync.py             # Sync status & manual offline toggle endpoints
            └── conflicts.py        # Local conflict resolution endpoints
```

---

## 4. Step-by-Step Implementation Tasks

- [ ] **Task 4.1: Edge API Stream & Sync Endpoints**
  - Implement `GET /events` with SSE streaming (`edge/api/stream.py`).
  - Implement `GET /sync/status`, `POST /sync/offline`, `POST /sync/now` (`edge/api/sync.py`).
  - Implement `GET /conflicts`, `POST /conflicts/{id}/resolve` (`edge/api/conflicts.py`).
  - Enable CORS middleware for `http://localhost:3000` (Device A) and `http://localhost:3001` (Device B).

- [ ] **Task 4.2: Startup Warmup in Lifespan (`edge/main.py`)**
  - Execute a dummy dense+BM25 embedding and dummy Ollama inference during startup so the first interactive demo click is instant.

- [ ] **Task 4.3: Next.js 14 Dashboard Foundation**
  - Initialize Next.js with App Router and Tailwind CSS.
  - Setup `@tanstack/react-query` and `useEdgeEvents` SSE listener hook.

- [ ] **Task 4.4: Sticky Top Bar with `OfflineToggle.tsx`**
  - Mount on all views: shows current simulated network state and outbox queue depth.

- [ ] **Task 4.5: Memory Inspector View (`/memories`)**
  - Table displaying `text`, `asset_tag`, `category`, `gate_source`, `gate_reason`, `version`, `sync_state`.
  - Action buttons: Add Note, Edit Note, Delete Note.
  - Retract button: Change shareable note to private (triggers tombstone retraction if synced).

- [ ] **Task 4.6: Search Playground View (`/search`)**
  - Multi-mode switcher: Hybrid (RRF) vs Dense vs BM25.
  - Performance badges displaying exact embedding vs vector search latency.

- [ ] **Task 4.7: Sync Status & Privacy Proof View (`/sync`)**
  - Live inspection of queued outbox items.
  - **Server Privacy Proof Panel:** Directly queries Cloud Sync API `GET /stats` to show `private_on_server = 0` and `routine_on_server = 0`.

- [ ] **Task 4.8: Conflict Resolution Inbox View (`/conflicts`)**
  - Side-by-side diff comparison between Local and Remote records.
  - Action triggers: "Keep Mine", "Keep Theirs", or "Merge (Edit)".

- [ ] **Task 4.9: Live Event Stream View (`/activity`)**
  - Real-time append of all emitted events (`memory.created`, `gate.decided`, `sync.push.ok`, etc.).

- [ ] **Task 4.10: Rehearsal Automation & Demo Scripts**
  - Write `edge/scripts/seed_demo.py` with scripted technician scenarios.
  - Write root `Makefile` to launch all services with single-command targets.

---

## 5. Code Specifications

### 5.1 Edge SSE Stream Router (`edge/edge/api/stream.py`)
```python
import asyncio, json
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from edge import events

router = APIRouter()

@router.get("/events")
async def stream(request: Request):
    q = events.subscribe()

    async def gen():
        try:
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream")
```

### 5.2 Edge Sync Router (`edge/edge/api/sync.py`)
```python
from fastapi import APIRouter
from edge import db
from edge.sync import outbox, connectivity
from edge.events import emit

router = APIRouter(prefix="/sync")

def _get(key: str):
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else None

@router.get("/status")
def status():
    return {
        "forced_offline": connectivity.forced_offline(),
        "outbox_depth": outbox.depth(),
        "last_push_at": _get("last_push_at"),
        "last_pull_at": _get("last_pull_at")
    }

@router.post("/offline")
def set_offline(on: bool):
    db.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('offline_forced', ?)",
        ("1" if on else "0",)
    )
    emit("sync.offline" if on else "sync.online", data={"manual": True})
    return status()
```

### 5.3 Lifespan with Warmup (`edge/edge/main.py`)
```python
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from edge import db, events
from edge.api import memories, search, sync, conflicts, stream
from edge.sync import worker
from edge.store import embed, shards
from edge.gate import gate

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    events.bind_loop(asyncio.get_running_loop())

    # Pre-warm models to eliminate cold-start latency for judges
    embed.embed_query("warm up query")
    gate.decide("warm up note for classifier")

    task = asyncio.create_task(worker.run())
    yield
    task.cancel()
    shards.private.shard.close()
    shards.shared.shard.close()

app = FastAPI(title="EdgeVault Edge Node", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (memories.router, search.router, sync.router, conflicts.router, stream.router):
    app.include_router(r)
```

### 5.4 React SSE Hook (`dashboard/lib/sse.ts`)
```typescript
import { useEffect, useState } from "react";

export type EdgeEvent = {
  ts: number;
  type: string;
  memory_id?: string;
  data: Record<string, unknown>;
};

export function useEdgeEvents(base: string, max = 200) {
  const [events, setEvents] = useState<EdgeEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(`${base}/events`);
    es.onmessage = (m) => {
      try {
        const parsed = JSON.parse(m.data);
        setEvents((prev) => [parsed, ...prev].slice(0, max));
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };
    return () => es.close();
  }, [base, max]);

  return events;
}
```

### 5.5 Global Offline Toggle (`dashboard/components/OfflineToggle.tsx`)
```tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { EDGE_API } from "@/lib/api";

export function OfflineToggle() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetch(`${EDGE_API}/sync/status`).then((r) => r.json()),
    refetchInterval: 2000,
  });

  const mutation = useMutation({
    mutationFn: (on: boolean) =>
      fetch(`${EDGE_API}/sync/offline?on=${on}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  });

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full border bg-background text-sm font-medium">
      <Switch
        id="offline-mode"
        checked={!!data?.forced_offline}
        onCheckedChange={(checked) => mutation.mutate(checked)}
      />
      <label htmlFor="offline-mode" className="cursor-pointer select-none">
        {data?.forced_offline ? (
          <span className="text-amber-500 font-semibold">Offline (Simulated)</span>
        ) : (
          <span className="text-emerald-500 font-semibold">Online (Connected)</span>
        )}
        <span className="text-muted-foreground ml-2">
          · Outbox: {data?.outbox_depth ?? 0}
        </span>
      </label>
    </div>
  );
}
```

### 5.6 Master Makefile (`Makefile`)
```makefile
.PHONY: cloud edge-a edge-b ui-a ui-b seed reset clean

cloud:
	docker compose up -d
	uv run python cloud/scripts/init_collection.py
	uv run uvicorn cloud.sync_api.main:app --port 8080 --reload

edge-a:
	DEVICE_ID=device-a PORT=7001 uv run uvicorn edge.main:app --port 7001 --reload

edge-b:
	DEVICE_ID=device-b PORT=7002 uv run uvicorn edge.main:app --port 7002 --reload

ui-a:
	cd dashboard && NEXT_PUBLIC_EDGE_API=http://localhost:7001 PORT=3000 npm run dev

ui-b:
	cd dashboard && NEXT_PUBLIC_EDGE_API=http://localhost:7002 PORT=3001 npm run dev -- -p 3001

seed:
	uv run python edge/scripts/seed_demo.py

reset:
	docker compose down -v
	rm -rf edge/data/device-a edge/data/device-b
	docker compose up -d
	uv run python cloud/scripts/init_collection.py
	DEVICE_ID=device-a uv run python edge/scripts/bootstrap_shared.py
	DEVICE_ID=device-b uv run python edge/scripts/bootstrap_shared.py
```

---

## 6. The 3-Minute Rehearsed Demo Script

| Elapsed | Screen View | Presenter Action | What Judges See |
|---|---|---|---|
| **0:00** | Introduction | State problem: Field techs lose knowledge offline; cloud sync risks data leakage. Introduce tagline: *"Private by default, intelligent when connected."* | Context & architecture overview |
| **0:15** | Side-by-Side Windows | Open Device A (`:3000`) and Device B (`:3001`). Turn both **Offline Toggles ON**. | Both nodes running offline |
| **0:25** | Device A | Add note: *"Gate code for the Noida plant is 4431"* | Categorized as **`private`** via rule `access_code`. Stays on private shard. |
| **0:40** | Device A | Add note: *"P-200 cavitation noise fixed by replacing the impeller; check it first on this model"* | Categorized as **`shareable`** by local LLM. Stored in shared shard; Outbox = 1. |
| **0:55** | Device A | Add note: *"Reached site at 10:15"* | Categorized as **`routine`**; TTL expiration badge (14 days). |
| **1:05** | Device A | Search *"pump making noise"* in Hybrid mode, then search *"P-200"* | Hybrid results in ~15 ms. BM25 hits exact "P-200" tag missed by dense vectors. |
| **1:25** | Device B | Search *"pump making noise"* (finds nothing). Edit pre-seeded note M1 offline. | Confirms offline isolation; local edit queued on B. |
| **1:40** | Device A | Turn **Offline Toggle OFF** | Activity feed streams `sync.online`, `sync.push.ok`. Outbox drops to 0. |
| **1:55** | Device B | Turn **Offline Toggle OFF** | Push runs, conflict detected on M1, pull completes. |
| **2:10** | Device B | Search *"pump making noise"* | **Hero Moment:** Tech A's fix appears on Tech B with badge `origin: device-a`. |
| **2:20** | Device B | Navigate to Conflicts Inbox | View side-by-side diff. Click **"Keep Mine"**; conflict resolved and synchronized. |
| **2:35** | Device A | Memories View: Manually override P-200 fix to `private` | UI displays *"Retracted from fleet"*. B removes note on next pull cycle. |
| **2:50** | Cloud Stats Panel | Open Server Stats card: `GET /stats` | **Proof:** `private_on_server = 0`, `routine_on_server = 0`. |

> [!IMPORTANT]
> **Pitch Rule:** Always pitch that EdgeVault is *"designed to keep sensitive information local by default."* Never make absolute claims of certified legal compliance.

---

## 7. Exit Criteria & Final Hackathon Checklist

- [ ] Execute `make reset && make seed`: entire fleet rebuilds cleanly in **< 2 minutes**.
- [ ] Run the complete 3-minute demo script **5 consecutive times** with zero manual database tampering.
- [ ] Server audit confirms: `private_on_server == 0` and `routine_on_server == 0`.
- [ ] High-definition backup video recorded and stored locally on both laptops.
- [ ] Fallback Plan B validated: Local Qdrant Docker running on presenter laptop in case venue Wi-Fi drops.
