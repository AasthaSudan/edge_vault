"""Run once while connected to the internet to pre-cache the embedding model."""
import sys
from pathlib import Path

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastembed import TextEmbedding
from edge.config import settings

def main():
    models_dir = settings.data_root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {settings.dense_model} to {models_dir}...")
    # Initialize TextEmbedding to cache the weights locally
    embedder = TextEmbedding(model_name=settings.dense_model, cache_dir=str(models_dir))
    # Test a small embed
    test_vec = list(embedder.embed(["test warmup note"]))
    print(f"FastEmbed model provisioned successfully! Vector dim: {len(test_vec[0])}")

if __name__ == "__main__":
    main()
