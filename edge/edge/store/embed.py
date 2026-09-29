from fastembed import TextEmbedding
from qdrant_edge import Bm25, Bm25Config
from edge.config import settings

MODELS_DIR = str(settings.data_root / "models")
_dense = None
_bm25 = None

def get_dense_embedder():
    global _dense
    if _dense is None:
        _dense = TextEmbedding(
            model_name=settings.dense_model,
            cache_dir=MODELS_DIR,
            local_files_only=True
        )
    return _dense

def get_bm25_embedder():
    global _bm25
    if _bm25 is None:
        _bm25 = Bm25(Bm25Config())
    return _bm25

def embed_doc(text: str) -> dict:
    dense_emb = get_dense_embedder()
    bm25_emb = get_bm25_embedder()
    dense = next(iter(dense_emb.embed([text]))).tolist()
    return {"dense": dense, "bm25": bm25_emb.embed_document(text)}

def embed_query(text: str, mode: str = "hybrid") -> dict:
    res = {}
    if mode in ("hybrid", "dense"):
        dense_emb = get_dense_embedder()
        res["dense"] = next(iter(dense_emb.embed([text]))).tolist()
    if mode in ("hybrid", "bm25"):
        bm25_emb = get_bm25_embedder()
        res["bm25"] = bm25_emb.embed_query(text)
    return res
