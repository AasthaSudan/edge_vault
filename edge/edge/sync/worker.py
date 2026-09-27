import asyncio
import time
import httpx
from edge.sync import connectivity, push, pull, outbox
from edge.events import emit

async def run():
    outbox.recover()
    delay = 5
    was_online = None
    last_pull = 0.0

    async with httpx.AsyncClient() as client:
        while True:
            try:
                is_online = await connectivity.online(client)
                if is_online != was_online:
                    emit("sync.online" if is_online else "sync.offline")
                    was_online = is_online

                if is_online:
                    pushed = 0
                    while True:
                        n = await push.push_once(client)
                        if n == 0:
                            break
                        pushed += n

                    # Pull after successful push, or at least every 30s when idle
                    if pushed > 0 or (time.time() - last_pull > 30):
                        if await pull.pull_once(client):
                            last_pull = time.time()

                    delay = 5
            except Exception as e:
                delay = min(delay * 2, 30)

            await asyncio.sleep(delay)
