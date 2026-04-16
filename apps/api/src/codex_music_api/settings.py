from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings for the Codex Music API."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="CODEX_MUSIC_",
        extra="ignore",
    )

    environment: str = Field(default="development")
    web_origin: str = Field(default="http://127.0.0.1:3000")
    storage_backend: str = Field(default="local")
    public_web_url: str = Field(default="http://127.0.0.1:3000")
    public_api_url: str = Field(default="http://127.0.0.1:8000")
    audio_provider: str = Field(default="audioshake")
    audio_provider_api_key: str = Field(default="")
    analysis_provider: str = Field(default="local-spectral-analysis")
    music_ai_api_key: str = Field(default="")
    lyrics_provider: str = Field(default="whisperx")
    midi_provider: str = Field(default="basic-pitch")
    cleanup_provider: str = Field(default="auphonic")
    cleanup_provider_api_key: str = Field(default="")
    generation_provider: str = Field(default="ace-step-via-fal")
    fal_key: str = Field(default="")
    provenance_backend: str = Field(default="c2pa")
    job_execution_mode: Literal["threaded", "inline"] = Field(default="threaded")
    stripe_secret_key: str = Field(default="")
    storage_bucket: str = Field(default="")
    data_dir: Path = Field(default=Path("./data"))
    media_dir: Path = Field(default=Path("./media"))
    app_name: str = Field(default="Codex Music API")
    api_v1_prefix: str = Field(default="/api/v1")
    app_version: str = Field(default="0.1.0")
    demo_seed_enabled: bool = Field(default=True)

    @property
    def database_path(self) -> Path:
        """Return the SQLite database path for the current environment."""

        return self.data_dir / "codex_music.db"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached application settings object."""

    return Settings()
