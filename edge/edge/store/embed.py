import json
import threading
from pathlib import Path
import numpy as np
from qdrant_edge import Bm25, Bm25Config
from edge.config import settings

MODELS_DIR = str(settings.data_root / "models")
_dense = None
_bm25 = None
_load_lock = threading.Lock()

# Models we run straight on onnxruntime. `import fastembed` also loads its image,
# rerank and HF-download stacks (~8-30 s on a busy laptop) for a model that is one
# ONNX file + tokenizer.json. Same files, same steps, same vectors as fastembed:
# tokenize -> ONNX -> CLS token -> L2 normalize.
_ONNX_SOURCES = {
    "BAAI/bge-small-en-v1.5": ("Qdrant/bge-small-en-v1.5-onnx-Q", "model_optimized.onnx"),
}


class _OnnxEmbedder:
    def __init__(self, model_dir: Path, model_file: str):
        import onnxruntime as ort
        from tokenizers import AddedToken, Tokenizer

        tok_cfg = json.loads((model_dir / "tokenizer_config.json").read_text(encoding="utf-8"))
        max_len = min(v for v in (tok_cfg.get("model_max_length"), tok_cfg.get("max_length"))
                      if isinstance(v, int) and not isinstance(v, bool) and v > 0)
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=max_len)
        special = model_dir / "special_tokens_map.json"
        if special.exists():
            for tok in json.loads(special.read_text(encoding="utf-8")).values():
                for t in (tok if isinstance(tok, list) else [tok]):
                    self.tokenizer.add_special_tokens([t if isinstance(t, str) else AddedToken(**t)])

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(model_dir / model_file), sess_options=so,
                                            providers=["CPUExecutionProvider"])
        self.input_names = {i.name for i in self.session.get_inputs()}

    def embed(self, texts: list[str]):
        # One text at a time (all callers do), so no padding is needed.
        for text in texts:
            enc = self.tokenizer.encode(text)
            ids = np.array([enc.ids], dtype=np.int64)
            feed = {"input_ids": ids}
            if "attention_mask" in self.input_names:
                feed["attention_mask"] = np.array([enc.attention_mask], dtype=np.int64)
            if "token_type_ids" in self.input_names:
                feed["token_type_ids"] = np.zeros_like(ids)
            out = self.session.run(None, feed)[0]
            vec = out[:, 0] if out.ndim == 3 else out
            yield (vec / np.maximum(np.linalg.norm(vec, axis=1, keepdims=True), 1e-12))[0]


def _snapshot_dir(repo: str) -> Path:
    """Resolve the Hugging Face cache layout that `make provision` (fastembed) writes."""
    root = Path(MODELS_DIR) / f"models--{repo.replace('/', '--')}"
    ref = (root / "refs" / "main").read_text().strip()
    return root / "snapshots" / ref


def get_dense_embedder():
    global _dense
    if _dense is None:
        with _load_lock:  # startup warmup and the first request may race to load
            if _dense is None:
                src = _ONNX_SOURCES.get(settings.dense_model)
                if src:
                    _dense = _OnnxEmbedder(_snapshot_dir(src[0]), src[1])
                else:
                    from fastembed import TextEmbedding
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
