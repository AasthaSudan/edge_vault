"""Idempotent Qdrant setup: the fleet collection and its payload indexes.

Runs on API startup (so a fresh deployment needs no manual step) and from
cloud/scripts/init_collection.py.
"""
from qdrant_client import QdrantClient, models

COLL = "shared_memory"

INDEXES = [
    ("category", models.PayloadSchemaType.KEYWORD),
    ("asset_tag", models.PayloadSchemaType.KEYWORD),
    ("device_id", models.PayloadSchemaType.KEYWORD),
    ("sync_state", models.PayloadSchemaType.KEYWORD),
    ("updated_at", models.PayloadSchemaType.INTEGER),
    ("server_ts", models.PayloadSchemaType.INTEGER),
    ("fleet_verified", models.PayloadSchemaType.BOOL),
    ("deleted", models.PayloadSchemaType.BOOL),
]


def ensure_collection(client: QdrantClient, verbose: bool = False) -> None:
    if not client.collection_exists(COLL):
        if verbose:
            print(f"Creating collection '{COLL}' with dense + BM25 sparse vectors...")
        client.create_collection(
            collection_name=COLL,
            vectors_config={"dense": models.VectorParams(size=384, distance=models.Distance.COSINE)},
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
            shard_number=1,  # edge devices pull shard 0
        )
    existing = set((client.get_collection(COLL).payload_schema or {}).keys())
    for field, schema in INDEXES:
        if field not in existing:
            client.create_payload_index(COLL, field_name=field, field_schema=schema)
            if verbose:
                print(f"  Created payload index for '{field}' ({schema})")
