from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    device_id: str = "device-a"
    author: str = "Tech A"
    data_root: Path = Path("./data")
    dense_model: str = "BAAI/bge-small-en-v1.5"
    dense_dim: int = 384
    sync_api_url: str = "http://localhost:8080"
    ollama_model: str = "gemma3:1b"
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
