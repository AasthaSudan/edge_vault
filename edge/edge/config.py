from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="allow")

    device_id: str = "device-a"
    author: str = "Tech A"
    data_root: Path = Path("./data")
    dense_model: str = "BAAI/bge-small-en-v1.5"
    dense_dim: int = 384
    sync_api_url: str = "http://localhost:8080"
    fleet_api_key: str = ""           # sent as a Bearer token to the cloud sync API
    # Browser origins allowed to call this edge API. Never "*": the edge serves PRIVATE notes,
    # and any web page the technician opens could otherwise read them from localhost.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
    # Host header values this API answers to. The edge listens on loopback only; a web page can still
    # reach it by pointing its own domain at 127.0.0.1 (DNS rebinding), and that request carries the
    # attacker's domain in Host. "testserver" is FastAPI's TestClient.
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    ollama_model: str = "qwen2.5:1.5b"
    llm_host: str = "http://127.0.0.1:11434"
    llm_num_ctx: int = 4096
    llm_keep_alive: str = "30m"
    llm_timeout_s: float = 20.0
    gate_mode: str = "async"
    gate_context_k: int = 4
    gate_corrections_k: int = 3
    gate_neighbour_min_score: float = 0.55
    # bge-small puts most technical sentences at 0.6-0.75 cosine to each other; measured
    # intended correction pairs score >= 0.80, unrelated notes <= 0.755 (tests/eval_gate.py).
    gate_correction_min_score: float = 0.78
    assistant_top_k: int = 4          # 6 -> 4: same eval quality, ~2 s less cold first-token (measured)
    assistant_context_chars: int = 6000
    assistant_history_turns: int = 2
    chat_retention_days: int = 7
    dedup_threshold: float = 0.92
    routine_ttl_days: int = 14
    port: int = 7001

    def cloud_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.fleet_api_key}"} if self.fleet_api_key else {}

    @property
    def allowed_host_list(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip() and o.strip() != "*"]

    @property
    def dir(self) -> Path:
        target = self.data_root / self.device_id
        target.mkdir(parents=True, exist_ok=True)
        return target

settings = Settings()
