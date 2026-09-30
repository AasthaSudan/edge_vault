"""A note the edge acknowledged must survive a crash / power loss (no close())."""
import os
import subprocess
import sys
import textwrap

WRITER = textwrap.dedent("""
    import os, sys
    from pathlib import Path
    from qdrant_edge import Point, UpdateOperation
    from edge.store.shards import Shard
    sh = Shard(Path(sys.argv[1]))
    for i in range(1, 6):
        with sh.lock:
            sh.shard.update(UpdateOperation.upsert_points(
                [Point(id=i, vector={"dense": [0.01 * i] * 384}, payload={"i": i})]))
    os._exit(0)  # hard kill: no close(), like a crash or pulled battery
""")


def test_writes_survive_hard_kill(tmp_path):
    shard_dir = tmp_path / "private"
    env = {**os.environ, "DEVICE_ID": "durability-test"}
    subprocess.run([sys.executable, "-c", WRITER, str(shard_dir)], check=True, env=env)

    from edge.store.shards import Shard
    sh = Shard(shard_dir)
    try:
        assert sh.shard.info().points_count == 5
    finally:
        sh.close()
