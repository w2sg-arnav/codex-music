from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from uuid import uuid4

from codex_music_api.providers import (
    STRICT_MUSIC_GENERATION_GUIDELINES,
    ProjectContext,
    ProviderStack,
    build_demo_provider_stack,
    build_refined_prompt,
    critique_generation_candidate,
    enhance_generation_prompt,
)
from codex_music_api.schemas import (
    AnalysisSummary,
    GenerationVersion,
    JobView,
    RefinementLoopSummary,
    RightsSummary,
)

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
        jobs = self._build_prep_jobs(project, timestamp)
        self._repository.replace_jobs(project_id, jobs)
        self._repository.set_project_status(project_id, "processing", timestamp)

        try:
            loop_summary: RefinementLoopSummary | None = None
            generation_result: GenerationResult | None = None
            if project.source_type in {"prompt", "reference"}:
                generation_result, loop_summary, project, context = (
                    self._run_generation_refinement_loop(
                        project_id,
                        project,
                        context,
                        prompt_job=jobs[0],
                        generation_job=jobs[1],
                        critic_job=jobs[2],
                    )
                )
                stage_index = 3
            else:
                stage_index = 0

            separation_result = self._provider_stack.separation.separate(
                context,
                generation_result=generation_result,
            )
            self._run_stage(
                project_id,
                jobs[stage_index],
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
                jobs[stage_index + 1],
                "Aligning lyric timeline and MIDI readiness...",
                completed_message=lyrics_result.message,
            )

            analysis_result = self._provider_stack.analysis.analyze(
                context,
                generation_result=generation_result,
                lyric_provider_name=lyrics_result.provider,
            )
            analysis = analysis_result.analysis.model_copy(
                update={
                    "lyric_excerpt": lyrics_result.lyric_excerpt,
                    "refinement_loop": loop_summary,
                }
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
                jobs[stage_index + 2],
                "Computing BPM, key, chords, and arrangement cues...",
                completed_message=analysis_result.message,
            )
            if stage_index == 0:
                critic_summary = (
                    "Critic scored "
                    f"{critic.average:.1f}/10 and marked the draft as "
                    f"{critic.verdict.lower()}."
                    if critic
                    else "Critic scoring was skipped because no score payload was generated."
                )
                self._run_stage(
                    project_id,
                    jobs[stage_index + 3],
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

    def _build_prep_jobs(self, project: ProjectDetail, timestamp: str) -> list[JobView]:
        """Build the staged job list for one prep run."""

        jobs: list[JobView] = []
        if project.source_type in {"prompt", "reference"}:
            jobs.extend(
                [
                    JobView(
                        id=f"job_{uuid4().hex[:12]}",
                        kind="prompt-enhancement",
                        status="queued",
                        provider=_effective_prompt_model(self._settings),
                        message="Queued prompt enhancement with strict music directives",
                        updated_at=timestamp,
                    ),
                    JobView(
                        id=f"job_{uuid4().hex[:12]}",
                        kind="generation",
                        status="queued",
                        provider=self._provider_stack.generation.provider_name,
                        message="Queued ACE-Step generation loop",
                        updated_at=timestamp,
                    ),
                    JobView(
                        id=f"job_{uuid4().hex[:12]}",
                        kind="critic-loop",
                        status="queued",
                        provider=_effective_critic_model(self._settings),
                        message="Queued critic scoring and auto-refinement loop",
                        updated_at=timestamp,
                    ),
                ]
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
                    message="Queued BPM, key, chord, and section detection",
                    updated_at=timestamp,
                ),
            ]
        )

        if project.source_type == "upload":
            jobs.append(
                JobView(
                    id=f"job_{uuid4().hex[:12]}",
                    kind="critic",
                    status="queued",
                    provider=_effective_critic_model(self._settings),
                    message="Queued critic scoring for the uploaded source",
                    updated_at=timestamp,
                )
            )

        return jobs

    def _run_generation_refinement_loop(
        self,
        project_id: str,
        project: ProjectDetail,
        context: ProjectContext,
        *,
        prompt_job: JobView,
        generation_job: JobView,
        critic_job: JobView,
    ) -> tuple[GenerationResult, RefinementLoopSummary, ProjectDetail, ProjectContext]:
        """Run prompt enhancement, generation, critic scoring, and auto-refinement."""

        base_prompt = _prompt_intent_from_context(context)
        prompt_model = (
            self._settings.openai_model
            if self._settings.openai_api_key
            else self._settings.prompt_model_provider
        )
        critic_model = (
            self._settings.openai_model
            if self._settings.openai_api_key
            else self._settings.critic_model_provider
        )
        loop_summary = RefinementLoopSummary(
            status="running",
            prompt_model=prompt_model,
            critic_model=critic_model,
            threshold=self._settings.refinement_threshold,
            max_iterations=self._settings.refinement_max_iterations,
            strict_guidelines=STRICT_MUSIC_GENERATION_GUIDELINES,
        )
        prompt_enhancement = enhance_generation_prompt(
            base_prompt,
            openai_api_key=self._settings.openai_api_key,
            model=self._settings.openai_model,
        )

        self._set_job_state(
            project_id,
            prompt_job,
            status="running",
            message="Enhancing prompt with strict composition and production guidelines...",
        )
        prompt_ready_analysis = project.analysis.model_copy(
            update={
                "refinement_loop": loop_summary,
                "bridge_notes": project.analysis.bridge_notes
                + [
                    *prompt_enhancement.notes,
                    "Versions that pass the critic threshold will be surfaced before editing.",
                ],
            }
        )
        self._repository.set_analysis(
            project_id,
            analysis=prompt_ready_analysis,
            updated_at=_timestamp(),
        )
        self._set_job_state(
            project_id,
            prompt_job,
            status="completed",
            message="Prompt enhancement ready; beginning generation and critic loop.",
        )

        versions: list[GenerationVersion] = []
        generation_candidates: list[
            tuple[ProjectContext, GenerationResult, AnalysisSummary, int | None]
        ] = []
        current_prompt = prompt_enhancement.prompt
        selected_index = 0
        best_score = -1.0

        for iteration in range(1, self._settings.refinement_max_iterations + 1):
            iteration_context = _context_with_prompt(context, current_prompt)
            self._set_job_state(
                project_id,
                generation_job,
                status="running",
                message=(
                    "Generating draft iteration "
                    f"{iteration}/{self._settings.refinement_max_iterations}..."
                ),
            )
            generation_result = self._provider_stack.generation.generate(iteration_context)
            audio_path, audio_filename, local_audio_path, audio_size_bytes = (
                self._persist_generation_audio(
                    project_id,
                    audio_url=generation_result.audio_url,
                    iteration=iteration,
                )
            )

            candidate_context = ProjectContext(
                project_id=context.project_id,
                name=context.name,
                source_type=context.source_type,
                source_notes=f"Prompt: {current_prompt}",
                audio_path=audio_path,
                audio_filename=audio_filename,
                local_audio_path=local_audio_path,
            )
            self._set_job_state(
                project_id,
                critic_job,
                status="running",
                message=(
                    "Critic is scoring iteration "
                    f"{iteration}/{self._settings.refinement_max_iterations} "
                    "for fidelity, musicality, emotion, production, and technical quality..."
                ),
            )
            loop_analysis_result = self._provider_stack.analysis.analyze(
                candidate_context,
                generation_result=generation_result,
                lyric_provider_name=self._settings.critic_model_provider,
            )
            candidate_analysis = loop_analysis_result.analysis
            critique_guidance = critique_generation_candidate(
                base_prompt=base_prompt,
                current_prompt=current_prompt,
                enhanced_prompt=generation_result.enhanced_prompt,
                candidate_analysis=candidate_analysis,
                openai_api_key=self._settings.openai_api_key,
                model=self._settings.openai_model,
            )
            critic = critique_guidance.critic if critique_guidance else candidate_analysis.critic
            if critique_guidance:
                candidate_analysis = candidate_analysis.model_copy(update={"critic": critic})
            critic_score = critic.average if critic else 0.0
            passed_threshold = bool(
                critic and critic.average >= self._settings.refinement_threshold
            )
            rewrite_brief: str | None = None
            if not passed_threshold and iteration < self._settings.refinement_max_iterations:
                if critique_guidance and critique_guidance.rewrite_prompt:
                    current_prompt = critique_guidance.rewrite_prompt
                    rewrite_brief = critique_guidance.rewrite_brief
                else:
                    current_prompt, rewrite_brief = build_refined_prompt(
                        base_prompt=base_prompt,
                        critic=critic,
                        previous_enhanced_prompt=generation_result.enhanced_prompt,
                        iteration=iteration,
                    )

            version = GenerationVersion(
                id=f"{project_id}_version_{iteration}",
                iteration=iteration,
                prompt_text=_truncate_text(_prompt_intent_from_context(iteration_context), 340),
                enhanced_prompt=generation_result.enhanced_prompt,
                audio_path=audio_path,
                provider=generation_result.provider,
                critic=critic,
                passed_threshold=passed_threshold,
                rewrite_brief=rewrite_brief,
                improvement_suggestions=(
                    critique_guidance.improvement_suggestions
                    if critique_guidance
                    else critic.notes
                    if critic
                    else []
                ),
                selected_for_editing=False,
            )
            versions.append(version)
            generation_candidates.append(
                (
                    candidate_context,
                    generation_result,
                    candidate_analysis,
                    audio_size_bytes,
                )
            )

            if critic_score > best_score:
                best_score = critic_score
                selected_index = len(generation_candidates) - 1

            loop_summary = loop_summary.model_copy(update={"versions": versions})
            live_analysis = candidate_analysis.model_copy(
                update={
                    "enhanced_prompt": generation_result.enhanced_prompt,
                    "refinement_loop": loop_summary,
                }
            )
            self._repository.set_analysis(
                project_id,
                analysis=live_analysis,
                updated_at=_timestamp(),
            )

            if passed_threshold:
                selected_index = len(generation_candidates) - 1
                break

        if not generation_candidates:
            raise RuntimeError("Generation loop produced no candidate versions.")

        chosen_context, chosen_generation, chosen_analysis, chosen_audio_size = (
            generation_candidates[selected_index]
        )
        chosen_version = versions[selected_index].model_copy(update={"selected_for_editing": True})
        versions[selected_index] = chosen_version
        chosen_critic = chosen_version.critic
        loop_status = "passed" if chosen_version.passed_threshold else "needs-review"
        loop_summary = loop_summary.model_copy(
            update={
                "status": loop_status,
                "selected_version_id": chosen_version.id,
                "versions": versions,
            }
        )

        self._set_job_state(
            project_id,
            generation_job,
            status="completed",
            message=(
                f"Surfaced {len(versions)} generation version(s); "
                f"version {chosen_version.iteration} is selected for editing."
            ),
        )
        self._set_job_state(
            project_id,
            critic_job,
            status="completed",
            message=(
                f"Critic selected version {chosen_version.iteration} "
                f"at {chosen_critic.average:.1f}/10."
                if chosen_critic
                else "Critic loop completed with heuristic fallback scoring."
            ),
        )

        if chosen_context.audio_path:
            self._repository.set_project_audio_source(
                project_id,
                audio_filename=chosen_context.audio_filename,
                audio_path=chosen_context.audio_path,
                audio_content_type="audio/wav",
                audio_size_bytes=chosen_audio_size,
                updated_at=_timestamp(),
            )

        final_loop_analysis = chosen_analysis.model_copy(
            update={
                "enhanced_prompt": chosen_generation.enhanced_prompt,
                "refinement_loop": loop_summary,
                "bridge_notes": chosen_analysis.bridge_notes
                + [
                    f"Version {chosen_version.iteration} was selected for editor handoff.",
                    (
                        "Locked timeline regions can now preserve strong sections "
                        "while further edits land."
                    ),
                ],
            }
        )
        self._repository.set_analysis(
            project_id,
            analysis=final_loop_analysis,
            updated_at=_timestamp(),
        )

        refreshed_project = self._repository.get_project(project_id)
        if refreshed_project is None:
            raise RuntimeError("Selected generation version could not be reloaded.")

        return (
            chosen_generation,
            loop_summary,
            refreshed_project,
            _build_project_context(refreshed_project, self._settings),
        )

    def _persist_generation_audio(
        self,
        project_id: str,
        *,
        audio_url: str | None,
        iteration: int,
    ) -> tuple[str | None, str | None, str | None, int | None]:
        """Persist one generated draft locally when a remote asset exists."""

        if not audio_url:
            return None, None, None, None

        filename = f"{project_id}-iteration-{iteration}.wav"
        try:
            public_path, audio_size_bytes = self._storage.save_remote_audio(
                project_id,
                source_url=audio_url,
                filename=filename,
            )
            local_audio_path = self._settings.media_dir / Path(public_path.removeprefix("/media/"))
            return public_path, filename, str(local_audio_path), audio_size_bytes
        except Exception:
            return audio_url, filename, None, None

    def _set_job_state(
        self,
        project_id: str,
        job: JobView,
        *,
        status: Literal["queued", "running", "completed", "failed"],
        message: str,
    ) -> None:
        """Persist one explicit job transition during long-running workflows."""

        job.status = status
        job.message = message
        job.updated_at = _timestamp()
        self._repository.upsert_job(project_id, job)
        time.sleep(0.25)

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
    demo_audio_size = (
        demo_audio_local_path.stat().st_size if demo_audio_local_path.exists() else None
    )
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
        update={
            "lyric_excerpt": lyrics_result.lyric_excerpt,
            "refinement_loop": RefinementLoopSummary(
                status="passed",
                prompt_model=_effective_prompt_model(settings),
                critic_model=_effective_critic_model(settings),
                threshold=settings.refinement_threshold,
                max_iterations=settings.refinement_max_iterations,
                strict_guidelines=STRICT_MUSIC_GENERATION_GUIDELINES,
                selected_version_id=f"{context.project_id}_version_1",
                versions=[
                    GenerationVersion(
                        id=f"{context.project_id}_version_1",
                        iteration=1,
                        prompt_text=_prompt_intent_from_context(context),
                        enhanced_prompt=generation_result.enhanced_prompt,
                        audio_path=context.audio_path,
                        provider=demo_stack.generation.provider_name,
                        critic=analysis_result.analysis.critic,
                        passed_threshold=bool(
                            analysis_result.analysis.critic
                            and analysis_result.analysis.critic.average
                            >= settings.refinement_threshold
                        ),
                        rewrite_brief=None,
                        improvement_suggestions=(
                            analysis_result.analysis.critic.notes
                            if analysis_result.analysis.critic
                            else []
                        ),
                        selected_for_editing=True,
                    )
                ],
            ),
        }
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
                    id="job_demo_prompt_enhancement",
                    kind="prompt-enhancement",
                    status="completed",
                    provider=_effective_prompt_model(settings),
                    message="Prompt enhancer translated the demo brief into a stricter music plan.",
                    updated_at=now,
                ),
                JobView(
                    id="job_demo_generation",
                    kind="generation",
                    status="completed",
                    provider=demo_stack.generation.provider_name,
                    message=generation_result.message,
                    updated_at=now,
                ),
                JobView(
                    id="job_demo_critic_loop",
                    kind="critic-loop",
                    status="completed",
                    provider=_effective_critic_model(settings),
                    message="Critic approved the surfaced demo version for editor handoff.",
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
                id="job_demo_prompt_enhancement",
                kind="prompt-enhancement",
                status="completed",
                provider=_effective_prompt_model(settings),
                message="Prompt enhancer translated the demo brief into a stricter music plan.",
                updated_at=now,
            ),
            JobView(
                id="job_demo_generation",
                kind="generation",
                status="completed",
                provider=demo_stack.generation.provider_name,
                message=generation_result.message,
                updated_at=now,
            ),
            JobView(
                id="job_demo_critic_loop",
                kind="critic-loop",
                status="completed",
                provider=_effective_critic_model(settings),
                message="Critic approved the surfaced demo version for editor handoff.",
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


def _prompt_intent_from_context(context: ProjectContext) -> str:
    """Extract the actual creative intent from a project context."""

    if context.source_notes and "Prompt:" in context.source_notes:
        prompt_text = context.source_notes.split("Prompt:", 1)[1]
        return prompt_text.split("|", 1)[0].strip()
    if context.source_notes:
        return context.source_notes.strip()
    return context.name


def _context_with_prompt(context: ProjectContext, prompt_text: str) -> ProjectContext:
    """Return a project context with a rewritten creative prompt."""

    return ProjectContext(
        project_id=context.project_id,
        name=context.name,
        source_type=context.source_type,
        source_notes=f"Prompt: {prompt_text}",
        audio_path=context.audio_path,
        audio_filename=context.audio_filename,
        local_audio_path=context.local_audio_path,
    )


def _truncate_text(value: str, limit: int) -> str:
    """Trim verbose prompts for compact workspace display."""

    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def _effective_prompt_model(settings: Settings) -> str:
    """Return the active prompt enhancer label for the current environment."""

    return settings.openai_model if settings.openai_api_key else settings.prompt_model_provider


def _effective_critic_model(settings: Settings) -> str:
    """Return the active critic label for the current environment."""

    return settings.openai_model if settings.openai_api_key else settings.critic_model_provider


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
