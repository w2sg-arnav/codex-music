from __future__ import annotations

from fastapi import APIRouter

from codex_music_api.catalog import (
    build_architecture_plan,
    build_capability_catalog,
    build_deployment_readiness,
)
from codex_music_api.schemas import (
    ArchitecturePlanResponse,
    CapabilityCatalogResponse,
    DeploymentReadinessResponse,
)
from codex_music_api.settings import get_settings

router = APIRouter(prefix="/capabilities", tags=["capabilities"])


@router.get("", response_model=CapabilityCatalogResponse)
def list_capabilities() -> CapabilityCatalogResponse:
    """Return the studio capability map used by the web app."""

    return build_capability_catalog(get_settings())


@router.get("/architecture", response_model=ArchitecturePlanResponse)
def get_architecture() -> ArchitecturePlanResponse:
    """Return the higher-level dual-engine architecture for the studio."""

    return build_architecture_plan(get_settings())


@router.get("/deployment-readiness", response_model=DeploymentReadinessResponse)
def get_deployment_readiness() -> DeploymentReadinessResponse:
    """Return the current deployment and credential readiness state."""

    return build_deployment_readiness(get_settings())
