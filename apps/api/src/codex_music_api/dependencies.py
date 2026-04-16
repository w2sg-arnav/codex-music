from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import Request  # noqa: TC002

if TYPE_CHECKING:
    from codex_music_api.providers import ProviderStack
    from codex_music_api.repository import StudioRepository
    from codex_music_api.storage import LocalMediaStorage
    from codex_music_api.studio_runner import StudioPrepRunner


def get_repository(request: Request) -> StudioRepository:
    """Return the shared repository from application state."""

    return cast("StudioRepository", request.app.state.repository)


def get_storage(request: Request) -> LocalMediaStorage:
    """Return the shared media storage manager from application state."""

    return cast("LocalMediaStorage", request.app.state.storage)


def get_runner(request: Request) -> StudioPrepRunner:
    """Return the studio prep runner from application state."""

    return cast("StudioPrepRunner", request.app.state.runner)


def get_provider_stack(request: Request) -> ProviderStack:
    """Return the provider stack from application state."""

    return cast("ProviderStack", request.app.state.provider_stack)
