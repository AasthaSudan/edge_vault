import os
import sys
from dotenv import load_dotenv
load_dotenv()

from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
KEY = os.getenv("QDRANT_API_KEY", None)
COLL = "shared_memory"

def init_collection():
    print(f"Connecting to Qdrant at {QDRANT_URL}...")
    client = QdrantClient(url=QDRANT_URL, api_key=KEY)

    if not client.collection_exists(COLL):
        print(f"Creating collection '{COLL}' with dual dense and BM25 sparse vectors...")
        client.create_collection(
            collection_name=COLL,
            vectors_config={"dense": models.VectorParams(size=384, distance=models.Distance.COSINE)},
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
            shard_number=1,  # Edge devices pull shard 0
        )
    else:
        print(f"Collection '{COLL}' already exists.")

    indexes = [
        ("category", models.PayloadSchemaType.KEYWORD),
        ("asset_tag", models.PayloadSchemaType.KEYWORD),
        ("device_id", models.PayloadSchemaType.KEYWORD),
        ("sync_state", models.PayloadSchemaType.KEYWORD),
        ("updated_at", models.PayloadSchemaType.INTEGER),
        ("server_ts", models.PayloadSchemaType.INTEGER),
        ("deleted", models.PayloadSchemaType.BOOL),
    ]

    for field, schema in indexes:
        try:
            client.create_payload_index(COLL, field_name=field, field_schema=schema)
            print(f"  Created payload index for '{field}' ({schema})")
        except Exception as e:
            # Index might already exist
            pass

    print(f"Successfully initialized '{COLL}' on Qdrant Server!")

if __name__ == "__main__":
    init_collection()
