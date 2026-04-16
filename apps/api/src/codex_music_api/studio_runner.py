from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from codex_music_api.providers import ProjectContext, ProviderStack, build_demo_provider_stack
from codex_music_api.schemas import JobView, RightsSummary

if TYPE_CHECKING:
    from collections.abc import Callable

    from codex_music_api.providers import GenerationResult
    from codex_music_api.repository import StudioRepository
    from codex_music_api.schemas import ProjectDetail
    from codex_music_api.settings import Settings
    from codex_music_api.storage import LocalMediaStorage


class StudioPrepRunner:
    """Run provider-backed prep and finishing workflows for one project."""

    def __init__(
        self,
        repository: StudioRepository,
        storage: LocalMediaStorage,
        settings: Settings,
        provider_stack: ProviderStack,
    ) -> None:
        """Create a runner that updates projects in the background."""

        self._repository = repository
        self._storage = storage
        self._settings = settings
        self._provider_stack = provider_stack
        self._active_project_ids: set[str] = set()
        self._lock = threading.Lock()

    def launch(self, project_id: str) -> None:
        """Start studio prep if it is not already running for the project."""

        self._start(project_id, target=self._run_studio_prep, blocking=False)

    def run_now(self, project_id: str) -> None:
        """Run studio prep in the current request lifecycle."""

        self._start(project_id, target=self._run_studio_prep, blocking=True)

    def launch_cleanup(self, project_id: str) -> None:
        """Start a cleanup pass if the project is currently idle."""

        self._start(project_id, target=self._run_cleanup_pass, blocking=False)

    def run_cleanup_now(self, project_id: str) -> None:
        """Run cleanup in the current request lifecycle."""

        self._start(project_id, target=self._run_cleanup_pass, blocking=True)

    def _start(
        self,
        project_id: str,
        *,
        target: Callable[[str], None],
        blocking: bool,
    ) -> None:
        """Run or launch one project task if it is currently idle."""

        if not self._mark_project_active(project_id):
            return

        if blocking:
            target(project_id)
            return

        thread = threading.Thread(
            target=target,
            args=(project_id,),
            daemon=True,
        )
        thread.start()

    def _mark_project_active(self, project_id: str) -> bool:
        """Mark one project as active if no other run is currently in flight."""

        with self._lock:
            if project_id in self._active_project_ids:
                return False
            self._active_project_ids.add(project_id)
        return True

    def _run_studio_prep(self, project_id: str) -> None:
        """Run the staged prep workflow and update project state."""

        project = self._repository.get_project(project_id)
        if project is None:
            self._release_project(project_id)
            return

        context = _build_project_context(project, self._settings)
        timestamp = _timestamp()
        jobs: list[JobView] = []
        if project.source_type in {"prompt", "reference"}:
            jobs.append(
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="generation",
                    status="queued",
                    provider=self._provider_stack.generation.provider_name,
                    message="Queued ACE-Step draft generation from prompt/reference input",
                    updated_at=timestamp,
                )
            )

        jobs.extend(
            [
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="separation",
                    status="queued",
                    provider=self._provider_stack.separation.provider_name,
                    message="Queued stem extraction",
                    updated_at=timestamp,
                ),
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="lyrics",
                    status="queued",
                    provider=self._provider_stack.lyrics.provider_name,
                    message="Queued lyric alignment",
                    updated_at=timestamp,
                ),
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="analysis",
                    status="queued",
                    provider=self._provider_stack.analysis.provider_name,
                    message="Queued BPM, key, and chord detection",
                    updated_at=timestamp,
                ),
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="critic",
                    status="queued",
                    provider=self._provider_stack.analysis.provider_name,
                    message="Queued fidelity, quality, and production scoring",
                    updated_at=timestamp,
                ),
            ]
        )
        self._repository.replace_jobs(project_id, jobs)
        self._repository.set_project_status(project_id, "processing", timestamp)

        try:
            offset = 0
            generation_result: GenerationResult | None = None
            if project.source_type in {"prompt", "reference"}:
                generation_result = self._provider_stack.generation.generate(context)
                self._run_stage(
                    project_id,
                    jobs[0],
                    "Generating 48kHz stereo draft via ACE-Step / fal bridge...",
                    completed_message=generation_result.message,
                )
                offset = 1
                if generation_result.audio_url:
                    audio_path = generation_result.audio_url
                    audio_size_bytes: int | None = None
                    try:
                        audio_path, audio_size_bytes = self._storage.save_remote_audio(
                            project_id,
                            source_url=generation_result.audio_url,
                            filename=f"{project_id}-ace-step.wav",
                        )
                    except Exception:
                        audio_path = generation_result.audio_url
                        audio_size_bytes = None

                    self._repository.set_project_audio_source(
                        project_id,
                        audio_filename=f"{project_id}-ace-step.wav",
                        audio_path=audio_path,
                        audio_content_type="audio/wav",
                        audio_size_bytes=audio_size_bytes,
                        updated_at=_timestamp(),
                    )
                    refreshed_project = self._repository.get_project(project_id)
                    if refreshed_project is not None:
                        project = refreshed_project
                        context = _build_project_context(project, self._settings)

            separation_result = self._provider_stack.separation.separate(
                context,
                generation_result=generation_result,
            )
            self._run_stage(
                project_id,
                jobs[offset],
                "Separating vocal, drums, bass, and music bed...",
                completed_message=separation_result.message,
            )
            self._repository.replace_stems(
                project_id,
                stems=separation_result.stems,
                updated_at=_timestamp(),
            )

            lyrics_result = self._provider_stack.lyrics.align(
                context,
                generation_result=generation_result,
            )
            self._run_stage(
                project_id,
                jobs[offset + 1],
                "Aligning lyric timeline and MIDI readiness...",
                completed_message=lyrics_result.message,
            )

            analysis_result = self._provider_stack.analysis.analyze(
                context,
                generation_result=generation_result,
                lyric_provider_name=lyrics_result.provider,
            )
            analysis = analysis_result.analysis.model_copy(
                update={"lyric_excerpt": lyrics_result.lyric_excerpt}
            )
            critic = analysis.critic
            if critic and critic.average < 7.5:
                analysis = analysis.model_copy(
                    update={
                        "bridge_notes": analysis.bridge_notes
                        + [
                            "Critic score fell below the refine threshold, so the "
                            "next pass should tighten contrast and harmonic clarity.",
                        ]
                    }
                )
            self._run_stage(
                project_id,
                jobs[offset + 2],
                "Computing BPM, key, chords, and arrangement cues...",
                completed_message=analysis_result.message,
            )
            critic_summary = (
                "Critic scored "
                f"{critic.average:.1f}/10 and marked the draft as "
                f"{critic.verdict.lower()}."
                if critic
                else "Critic scoring was skipped because no score payload was generated."
            )
            self._run_stage(
                project_id,
                jobs[offset + 3],
                "Scoring fidelity, emotion, production, and technical readiness...",
                completed_message=critic_summary,
            )
            self._repository.set_analysis(
                project_id,
                analysis=analysis,
                updated_at=_timestamp(),
            )

            self._repository.set_rights(
                project_id,
                rights=_build_rights(self._settings.provenance_backend),
                updated_at=_timestamp(),
            )
            self._repository.set_project_status(project_id, "ready", _timestamp())
        except Exception as error:  # pragma: no cover - defensive path
            failed_job = jobs[-1]
            failed_job.status = "failed"
            failed_job.message = f"Studio prep failed: {error}"
            failed_job.updated_at = _timestamp()
            self._repository.upsert_job(project_id, failed_job)
            self._repository.set_project_status(project_id, "attention", _timestamp())
        finally:
            self._release_project(project_id)

    def _run_cleanup_pass(self, project_id: str) -> None:
        """Run the finishing lane for one project."""

        project = self._repository.get_project(project_id)
        if project is None:
            self._release_project(project_id)
            return

        context = _build_project_context(project, self._settings)
        cleanup_job = JobView(
            id=f"job_{uuid4().hex[:12]}",
            kind="cleanup",
            status="queued",
            provider=self._provider_stack.cleanup.provider_name,
            message="Queued cleanup, loudness, and polished preview render",
            updated_at=_timestamp(),
        )
        self._repository.upsert_job(project_id, cleanup_job)
        self._repository.set_project_status(project_id, "processing", _timestamp())

        try:
            cleanup_result = self._provider_stack.cleanup.polish(context)
            self._run_stage(
                project_id,
                cleanup_job,
                "Running cleanup, denoise, and loudness polish...",
                completed_message=cleanup_result.message,
            )
            self._repository.set_project_polished_audio(
                project_id,
                polished_audio_filename=cleanup_result.polished_audio_filename,
                polished_audio_path=cleanup_result.polished_audio_path,
                polished_audio_content_type=cleanup_result.polished_audio_content_type,
                polished_audio_provider=cleanup_result.provider,
                updated_at=_timestamp(),
            )
            refreshed_project = self._repository.get_project(project_id)
            if refreshed_project is not None:
                updated_rights = refreshed_project.rights.model_copy(
                    update={
                        "export_readiness": (
                            "Polished preview ready for review and handoff export"
                        ),
                        "notes": refreshed_project.rights.notes
                        + [
                            "Cleanup pass completed; verify artistic intent before release.",
                        ],
                    }
                )
                self._repository.set_rights(
                    project_id,
                    rights=updated_rights,
                    updated_at=_timestamp(),
                )
            self._repository.set_project_status(project_id, "ready", _timestamp())
        except Exception as error:  # pragma: no cover - defensive path
            cleanup_job.status = "failed"
            cleanup_job.message = f"Cleanup pass failed: {error}"
            cleanup_job.updated_at = _timestamp()
            self._repository.upsert_job(project_id, cleanup_job)
            self._repository.set_project_status(project_id, "attention", _timestamp())
        finally:
            self._release_project(project_id)

    def _run_stage(
        self,
        project_id: str,
        job: JobView,
        running_message: str,
        *,
        completed_message: str = "Completed successfully",
    ) -> None:
        """Transition one job through running and completed states."""

        job.status = "running"
        job.message = running_message
        job.updated_at = _timestamp()
        self._repository.upsert_job(project_id, job)
        time.sleep(0.8)

        job.status = "completed"
        job.message = completed_message
        job.updated_at = _timestamp()
        self._repository.upsert_job(project_id, job)

    def _release_project(self, project_id: str) -> None:
        """Release the active-project lock for one project."""

        with self._lock:
            self._active_project_ids.discard(project_id)


def seed_demo_project(
    repository: StudioRepository,
    settings: Settings,
    provider_stack: ProviderStack,
) -> None:
    """Create a ready-to-explore demo project on first boot."""

    del provider_stack
    now = _timestamp()
    demo_stack = build_demo_provider_stack(settings)
    demo_audio_filename = "midnight-echo-preview.mp3"
    demo_audio_public_path = f"/media/demo/{demo_audio_filename}"
    demo_audio_local_path = settings.media_dir / "demo" / demo_audio_filename
    demo_audio_size = demo_audio_local_path.stat().st_size if demo_audio_local_path.exists() else None
    context = ProjectContext(
        project_id="proj_demo_midnight_echo",
        name="Midnight Echo Demo",
        source_type="reference",
        source_notes="Prompt: dream-pop city drive with airy vocals | Reference URL: demo seed",
        audio_path=demo_audio_public_path if demo_audio_local_path.exists() else None,
        audio_filename=demo_audio_filename if demo_audio_local_path.exists() else None,
        local_audio_path=str(demo_audio_local_path) if demo_audio_local_path.exists() else None,
    )
    generation_result = demo_stack.generation.generate(context)
    separation_result = demo_stack.separation.separate(
        context,
        generation_result=generation_result,
    )
    lyrics_result = demo_stack.lyrics.align(
        context,
        generation_result=generation_result,
    )
    analysis_result = demo_stack.analysis.analyze(
        context,
        generation_result=generation_result,
        lyric_provider_name=lyrics_result.provider,
    )
    analysis = analysis_result.analysis.model_copy(
        update={"lyric_excerpt": lyrics_result.lyric_excerpt}
    )

    existing_demo = repository.get_project(context.project_id)
    if existing_demo is not None:
        repository.set_project_audio_source(
            context.project_id,
            audio_filename=context.audio_filename,
            audio_path=context.audio_path,
            audio_content_type="audio/mpeg" if context.audio_path else None,
            audio_size_bytes=demo_audio_size,
            updated_at=now,
        )
        repository.set_analysis(context.project_id, analysis, updated_at=now)
        repository.set_rights(
            context.project_id,
            _build_rights(settings.provenance_backend),
            updated_at=now,
        )
        repository.set_project_status(context.project_id, "ready", now)
        repository.replace_stems(context.project_id, stems=separation_result.stems, updated_at=now)
        repository.replace_jobs(
            context.project_id,
            jobs=[
                JobView(
                    id="job_demo_generation",
                    kind="generation",
                    status="completed",
                    provider=demo_stack.generation.provider_name,
                    message=generation_result.message,
                    updated_at=now,
                ),
                JobView(
                    id="job_demo_separation",
                    kind="separation",
                    status="completed",
                    provider=demo_stack.separation.provider_name,
                    message=separation_result.message,
                    updated_at=now,
                ),
                JobView(
                    id="job_demo_lyrics",
                    kind="lyrics",
                    status="completed",
                    provider=demo_stack.lyrics.provider_name,
                    message=lyrics_result.message,
                    updated_at=now,
                ),
                JobView(
                    id="job_demo_analysis",
                    kind="analysis",
                    status="completed",
                    provider=demo_stack.analysis.provider_name,
                    message=analysis_result.message,
                    updated_at=now,
                ),
            ],
        )
        return

    if repository.list_projects():
        return

    project = repository.create_project(
        project_id=context.project_id,
        name=context.name,
        source_type=context.source_type,
        status="ready",
        created_at=now,
        updated_at=now,
        primary_provider=settings.generation_provider,
        audio_filename=context.audio_filename,
        audio_path=context.audio_path,
        source_notes=context.source_notes,
        audio_content_type="audio/mpeg" if context.audio_path else None,
        audio_size_bytes=demo_audio_size,
        analysis=analysis,
        rights=_build_rights(settings.provenance_backend),
        polished_audio_filename=None,
        polished_audio_path=None,
        polished_audio_content_type=None,
        polished_audio_provider=None,
    )
    repository.replace_stems(project.id, stems=separation_result.stems, updated_at=now)
    repository.replace_jobs(
        project.id,
        jobs=[
            JobView(
                id="job_demo_generation",
                kind="generation",
                status="completed",
                provider=demo_stack.generation.provider_name,
                message=generation_result.message,
                updated_at=now,
            ),
            JobView(
                id="job_demo_separation",
                kind="separation",
                status="completed",
                provider=demo_stack.separation.provider_name,
                message=separation_result.message,
                updated_at=now,
            ),
            JobView(
                id="job_demo_lyrics",
                kind="lyrics",
                status="completed",
                provider=demo_stack.lyrics.provider_name,
                message=lyrics_result.message,
                updated_at=now,
            ),
            JobView(
                id="job_demo_analysis",
                kind="analysis",
                status="completed",
                provider=demo_stack.analysis.provider_name,
                message=analysis_result.message,
                updated_at=now,
            ),
        ],
    )


def _build_project_context(project: ProjectDetail, settings: Settings) -> ProjectContext:
    """Convert a stored project into provider input."""

    local_audio_path: str | None = None
    if project.audio_path and project.audio_path.startswith("/media/"):
        relative_media_path = project.audio_path.removeprefix("/media/")
        candidate = settings.media_dir / Path(relative_media_path)
        if candidate.exists():
            local_audio_path = str(candidate)

    return ProjectContext(
        project_id=project.id,
        name=project.name,
        source_type=project.source_type,
        source_notes=project.source_notes,
        audio_path=project.audio_path,
        audio_filename=project.audio_filename,
        local_audio_path=local_audio_path,
    )


def _build_rights(provenance_backend: str) -> RightsSummary:
    """Return the default rights posture for MVP exports."""

    return RightsSummary(
        clearance="Review source rights before public or commercial release",
        provenance_status=f"{provenance_backend} export signing planned in phase 3",
        export_readiness="Internal review ready, commercial release needs confirmation",
        notes=[
            "Original upload ownership must be confirmed project-by-project.",
            "Voice likeness and sample clearance checks stay manual until policy tooling lands.",
        ],
    )


def _timestamp() -> str:
    """Return a UTC timestamp string suitable for UI display and ordering."""

    return datetime.now(UTC).isoformat(timespec="seconds")
