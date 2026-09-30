import os
import sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qdrant_client import QdrantClient
from sync_api.bootstrap import ensure_collection, COLL

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
KEY = os.getenv("QDRANT_API_KEY") or None


def init_collection():
    print(f"Connecting to Qdrant at {QDRANT_URL}...")
    ensure_collection(QdrantClient(url=QDRANT_URL, api_key=KEY), verbose=True)
    print(f"Successfully initialized '{COLL}' on Qdrant Server!")


if __name__ == "__main__":
    init_collection()
