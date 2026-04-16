from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from codex_music_api.providers import build_provider_stack
from codex_music_api.repository import StudioRepository
from codex_music_api.routes.capabilities import router as capabilities_router
from codex_music_api.routes.health import router as health_router
from codex_music_api.routes.projects import router as projects_router
from codex_music_api.settings import get_settings
from codex_music_api.storage import LocalMediaStorage
from codex_music_api.studio_runner import StudioPrepRunner, seed_demo_project

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

settings = get_settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.media_dir.mkdir(parents=True, exist_ok=True)
allowed_origins = ["*"] if settings.web_origin == "*" else [settings.web_origin]
allow_credentials = settings.web_origin != "*"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize shared application services and seed demo data."""

    repository = StudioRepository(settings.database_path)
    repository.initialize()
    storage = LocalMediaStorage(settings.media_dir)
    storage.prepare()
    provider_stack = build_provider_stack(settings)
    runner = StudioPrepRunner(repository, storage, settings, provider_stack)

    app.state.repository = repository
    app.state.storage = storage
    app.state.provider_stack = provider_stack
    app.state.runner = runner

    if settings.demo_seed_enabled:
        seed_demo_project(repository, settings, provider_stack)

    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    summary="Typed orchestration API for the Codex Music web studio.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(capabilities_router, prefix=settings.api_v1_prefix)
app.include_router(projects_router, prefix=settings.api_v1_prefix)
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")
