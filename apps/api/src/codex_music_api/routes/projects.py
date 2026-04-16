from __future__ import annotations

import json
import mimetypes
import re
import time
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse

from codex_music_api.dependencies import get_repository, get_runner, get_storage
from codex_music_api.schemas import (
    AnalysisSummary,
    ProjectDetail,
    ProjectImportResponse,
    ProjectSummary,
    RightsSummary,
    StudioPrepResponse,
)
from codex_music_api.settings import get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator

    from codex_music_api.repository import StudioRepository
    from codex_music_api.settings import Settings
    from codex_music_api.storage import LocalMediaStorage
    from codex_music_api.studio_runner import StudioPrepRunner

router = APIRouter(prefix="/projects", tags=["projects"])

ProjectRepository = Annotated["StudioRepository", Depends(get_repository)]
ProjectStorage = Annotated["LocalMediaStorage", Depends(get_storage)]
ProjectRunner = Annotated["StudioPrepRunner", Depends(get_runner)]
ProjectName = Annotated[str, Form()]
ProjectSourceType = Annotated[Literal["upload", "prompt", "reference"], Form()]
ProjectUpload = Annotated[UploadFile | None, File()]
PromptText = Annotated[str | None, Form()]
ReferenceUrl = Annotated[str | None, Form()]


@router.get("", response_model=list[ProjectSummary])
def list_projects(
    repository: ProjectRepository,
) -> list[ProjectSummary]:
    """Return all studio projects for the dashboard."""

    return repository.list_projects()


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(
    project_id: str,
    repository: ProjectRepository,
) -> ProjectDetail:
    """Return one project for the studio workspace."""

    project = repository.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("/{project_id}/events")
def stream_project_events(
    project_id: str,
    repository: ProjectRepository,
) -> StreamingResponse:
    """Stream live project updates for the generation and prep loop."""

    project = repository.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    def event_stream() -> Iterator[bytes]:
        last_payload: str | None = None
        for _ in range(120):
            latest = repository.get_project(project_id)
            if latest is None:
                break

            payload = json.dumps(
                {
                    "id": latest.id,
                    "status": latest.status,
                    "jobs": [job.model_dump(mode="json") for job in latest.jobs],
                    "refinement_loop": (
                        latest.analysis.refinement_loop.model_dump(mode="json")
                        if latest.analysis.refinement_loop
                        else None
                    ),
                    "updated_at": latest.updated_at,
                }
            )
            if payload != last_payload:
                yield f"event: project\ndata: {payload}\n\n".encode()
                last_payload = payload

            active_jobs = any(job.status in {"queued", "running"} for job in latest.jobs)
            if latest.status in {"ready", "attention"} and not active_jobs:
                break
            time.sleep(1)

        yield b"event: end\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/import", response_model=ProjectImportResponse, status_code=status.HTTP_201_CREATED)
def import_project(
    name: ProjectName,
    repository: ProjectRepository,
    storage: ProjectStorage,
    source_type: ProjectSourceType = "upload",
    file: ProjectUpload = None,
    prompt_text: PromptText = None,
    reference_url: ReferenceUrl = None,
) -> ProjectImportResponse:
    """Create a new project from dashboard input and optional audio upload."""

    settings = get_settings()
    now = datetime.now(UTC).isoformat(timespec="seconds")
    project_id = f"proj_{uuid4().hex[:12]}"

    audio_path: str | None = None
    audio_size: int | None = None
    audio_filename: str | None = None
    audio_content_type: str | None = None
    if file is not None and file.filename:
        audio_path, audio_size = storage.save_project_audio(project_id, file)
        audio_filename = file.filename
        audio_content_type = file.content_type

    source_notes = _build_source_notes(
        source_type=source_type,
        prompt_text=prompt_text,
        reference_url=reference_url,
        audio_filename=audio_filename,
    )
    primary_provider = (
        settings.generation_provider
        if source_type in {"prompt", "reference"}
        else settings.audio_provider
    )

    project = repository.create_project(
        project_id=project_id,
        name=name.strip(),
        source_type=source_type,
        status="draft",
        created_at=now,
        updated_at=now,
        primary_provider=primary_provider,
        audio_filename=audio_filename,
        audio_path=audio_path,
        source_notes=source_notes,
        audio_content_type=audio_content_type,
        audio_size_bytes=audio_size,
        analysis=AnalysisSummary(
            engine_mode=(
                "ace-generate-edit" if source_type in {"prompt", "reference"} else "upload-first"
            ),
            provider=settings.analysis_provider,
            arrangement_notes=[
                (
                    "Run studio prep to generate an ACE draft and bridge it into the editor."
                    if source_type in {"prompt", "reference"}
                    else "Upload an audio source and run studio prep to populate structure."
                ),
            ],
        ),
        rights=RightsSummary(
            clearance="Rights review pending source confirmation",
            provenance_status="No export provenance generated yet",
            export_readiness="Draft only",
            notes=[
                "Commercial export stays blocked until source ownership is confirmed.",
            ],
        ),
    )
    return ProjectImportResponse(project=project)


@router.post("/{project_id}/studio-prep", response_model=StudioPrepResponse)
def run_studio_prep(
    project_id: str,
    repository: ProjectRepository,
    runner: ProjectRunner,
) -> StudioPrepResponse:
    """Start the studio prep workflow and return the refreshed project."""

    project = repository.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    settings = get_settings()
    if settings.job_execution_mode == "inline":
        runner.run_now(project_id)
    else:
        runner.launch(project_id)
    updated = repository.get_project(project_id)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return StudioPrepResponse(project=updated)


@router.post("/{project_id}/cleanup", response_model=StudioPrepResponse)
def run_cleanup_pass(
    project_id: str,
    repository: ProjectRepository,
    runner: ProjectRunner,
) -> StudioPrepResponse:
    """Start a cleanup and polish pass for a project."""

    project = repository.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not project.audio_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project has no audio source to polish yet",
        )

    settings = get_settings()
    if settings.job_execution_mode == "inline":
        runner.run_cleanup_now(project_id)
    else:
        runner.launch_cleanup(project_id)
    updated = repository.get_project(project_id)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return StudioPrepResponse(project=updated)


@router.get("/{project_id}/export-bundle")
def download_export_bundle(
    project_id: str,
    repository: ProjectRepository,
) -> StreamingResponse:
    """Build and return one portable project bundle."""

    project = repository.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    settings = get_settings()
    bundle = BytesIO()
    with ZipFile(bundle, mode="w", compression=ZIP_DEFLATED) as archive:
        manifest = project.model_dump(mode="json")
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr("analysis.json", json.dumps(manifest["analysis"], indent=2))
        archive.writestr("rights.json", json.dumps(manifest["rights"], indent=2))

        lyric_excerpt = project.analysis.lyric_excerpt
        if lyric_excerpt:
            archive.writestr("lyrics.txt", lyric_excerpt)

        _write_asset_into_bundle(
            archive,
            settings=settings,
            asset_path=project.audio_path,
            suggested_name=project.audio_filename or "source-audio",
            fallback_stem="source",
        )
        _write_asset_into_bundle(
            archive,
            settings=settings,
            asset_path=project.polished_audio_path,
            suggested_name=project.polished_audio_filename or "polished-preview",
            fallback_stem="polished",
        )

        written_sources: set[str] = set()
        for stem in project.stems:
            if not stem.audio_path or stem.audio_path in written_sources:
                continue
            _write_asset_into_bundle(
                archive,
                settings=settings,
                asset_path=stem.audio_path,
                suggested_name=stem.name,
                fallback_stem=stem.kind,
                folder="stems",
            )
            written_sources.add(stem.audio_path)

    bundle.seek(0)
    filename = f"{_slugify(project.name)}-export-bundle.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(bundle, media_type="application/zip", headers=headers)


def _build_source_notes(
    *,
    source_type: Literal["upload", "prompt", "reference"],
    prompt_text: str | None,
    reference_url: str | None,
    audio_filename: str | None,
) -> str | None:
    """Build a compact summary of the project inputs."""

    notes: list[str] = []
    if prompt_text:
        notes.append(f"Prompt: {prompt_text.strip()}")
    if reference_url:
        notes.append(f"Reference URL: {reference_url.strip()}")
    if audio_filename:
        notes.append(f"Uploaded file: {audio_filename}")
    if not notes and source_type == "prompt":
        notes.append("Prompt-led generation session waiting for creative direction.")
    if not notes and source_type == "reference":
        notes.append("Reference-led generation session waiting for input material.")
    return " | ".join(notes) if notes else None


def _write_asset_into_bundle(
    archive: ZipFile,
    *,
    settings: Settings,
    asset_path: str | None,
    suggested_name: str,
    fallback_stem: str,
    folder: str = "audio",
) -> None:
    """Add one project asset to the export bundle when it can be resolved."""

    if not asset_path:
        return

    asset_bytes, resolved_name = _resolve_asset_bytes(
        asset_path=asset_path,
        suggested_name=suggested_name,
        settings=settings,
    )
    if asset_bytes is None or resolved_name is None:
        return

    archive.writestr(f"{folder}/{_slugify(fallback_stem)}-{resolved_name}", asset_bytes)


def _resolve_asset_bytes(
    *,
    asset_path: str,
    suggested_name: str,
    settings: Settings,
) -> tuple[bytes | None, str | None]:
    """Resolve local or remote project media into one byte payload."""

    filename = _safe_filename(suggested_name, asset_path)
    if asset_path.startswith("/media/"):
        relative = asset_path.removeprefix("/media/")
        candidate = settings.media_dir / Path(relative)
        if candidate.exists():
            return candidate.read_bytes(), filename
        public_api_url = settings.public_api_url.rstrip("/")
        if public_api_url:
            return _download_remote_bytes(f"{public_api_url}{asset_path}"), filename

    if asset_path.startswith(("http://", "https://")):
        return _download_remote_bytes(asset_path), filename
    return None, None


def _download_remote_bytes(url: str) -> bytes | None:
    """Fetch one remote asset and return its bytes."""

    try:
        response = httpx.get(url, follow_redirects=True, timeout=90)
        response.raise_for_status()
    except Exception:
        return None
    return response.content


def _safe_filename(suggested_name: str, asset_path: str) -> str:
    """Return a readable filename for one bundle member."""

    suffix = Path(asset_path).suffix
    if not suffix:
        suffix = mimetypes.guess_extension(mimetypes.guess_type(asset_path)[0] or "") or ".bin"
    stem = _slugify(Path(suggested_name).stem or suggested_name or "asset")
    return f"{stem}{suffix}"


def _slugify(value: str) -> str:
    """Return a filesystem-friendly slug."""

    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "project"
