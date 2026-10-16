"""Environment-driven configuration. No secrets are hardcoded; see .env.example."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="")

    # --- LLM -------------------------------------------------------------
    llm_provider: Literal["groq", "gemini", "dev"] = "dev"
    groq_api_key: Optional[SecretStr] = None
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: Optional[SecretStr] = None
    gemini_model: str = "gemini-2.5-flash"
    llm_timeout_s: float = 30.0

    # --- Embeddings / RAG ------------------------------------------------
    embedding_provider: Literal["fastembed", "hash"] = "fastembed"
    fastembed_model: str = "BAAI/bge-small-en-v1.5"
    chunk_size: int = 800
    chunk_overlap: int = 150
    rag_top_k: int = 4
    rag_min_score: Optional[float] = None  # cosine similarity; provider default if unset
    handbook_url: str = (
        "https://raw.githubusercontent.com/Azure-Samples/azure-search-openai-demo/"
        "main/data/employee_handbook.pdf"
    )
    document_name: str = "employee_handbook.pdf"

    # --- Storage ---------------------------------------------------------
    data_dir: Path = BACKEND_DIR / "data"

    # --- Booking ---------------------------------------------------------
    timezone: str = "Asia/Kolkata"
    booking_require_confirmation: bool = True

    # --- API -------------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_message_chars: int = 2000
    log_level: str = "INFO"

    @property
    def checkpoint_db(self) -> Path:
        return self.data_dir / "checkpoints.sqlite"

    @property
    def bookings_db(self) -> Path:
        return self.data_dir / "bookings.sqlite"

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def pdf_path(self) -> Path:
        return self.data_dir / "source" / self.document_name

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_min_score(self) -> float:
        """Similarity floor below which retrieval is treated as 'no evidence'.

        Defaults are per embedder because cosine ranges differ. `hash` (0.07) was calibrated
        on eval/dev_questions.json; `fastembed` (0.40) is an UNVERIFIED starting point
        (it could not be downloaded where this was built): run `python -m scripts.evaluate`
        and adjust via RAG_MIN_SCORE. A second gate (the answerer) also declines
        unsupported questions, so this threshold favours recall.
        """
        if self.rag_min_score is not None:
            return self.rag_min_score
        return 0.40 if self.embedding_provider == "fastembed" else 0.07


@lru_cache
def get_settings() -> Settings:
    return Settings()
