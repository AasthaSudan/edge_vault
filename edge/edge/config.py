from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    device_id: str = "device-a"
    author: str = "Tech A"
    data_root: Path = Path("./data")
    dense_model: str = "BAAI/bge-small-en-v1.5"
    dense_dim: int = 384
    sync_api_url: str = "http://localhost:8080"
    ollama_model: str = "qwen2.5:1.5b"
    llm_host: str = "http://127.0.0.1:11434"
    llm_num_ctx: int = 4096
    llm_keep_alive: str = "30m"
    llm_timeout_s: float = 20.0
    gate_mode: str = "async"
    gate_context_k: int = 4
    gate_corrections_k: int = 3
    gate_neighbour_min_score: float = 0.55
    assistant_top_k: int = 6
    assistant_context_chars: int = 6000
    assistant_history_turns: int = 2
    chat_retention_days: int = 7
    dedup_threshold: float = 0.92
    routine_ttl_days: int = 14
    port: int = 7001

    @property
    def dir(self) -> Path:
        target = self.data_root / self.device_id
        target.mkdir(parents=True, exist_ok=True)
        return target

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
