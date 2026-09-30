import asyncio
import json
import time
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from edge import events

router = APIRouter(tags=["Stream"])

@router.get("/events")
async def stream(request: Request):
    """Server-Sent Events endpoint streaming real-time memory and sync events to dashboard."""
    q = events.subscribe()

    async def gen():
        try:
            # Send initial connected event
            yield f"data: {json.dumps({'type': 'stream.connected', 'ts': int(time.time() * 1000)})}\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream")
