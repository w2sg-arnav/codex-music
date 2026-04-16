from __future__ import annotations

from fastapi import APIRouter

from codex_music_api.schemas import HealthResponse
from codex_music_api.settings import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    """Return a simple health check response."""

    settings = get_settings()
    return HealthResponse(
        status="ok",
        environment=settings.environment,
        version=settings.app_version,
    )
