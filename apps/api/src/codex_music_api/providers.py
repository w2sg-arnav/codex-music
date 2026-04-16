from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from random import Random
from typing import TYPE_CHECKING, Any

import httpx

from codex_music_api.audio_analysis import analyze_audio_file
from codex_music_api.schemas import AnalysisSummary, ArrangementSection, CriticScores, StemView

if TYPE_CHECKING:
    from codex_music_api.settings import Settings

AUDIO_SHAKE_BASE_URL = "https://api.audioshake.ai"
FAL_ACE_STEP_APPLICATION = "fal-ai/ace-step/prompt-to-audio"
STRICT_MUSIC_GENERATION_GUIDELINES = [
    "Keep the arrangement section-aware with a clear intro, verse, chorus, and outro.",
    "Favor singable melodic contour and stable harmonic center over novelty for its own sake.",
    "Preserve emotional intent while keeping instrumentation coherent and mix-ready.",
    "Avoid clipping, harsh transients, and overcrowded low-mid buildup in the prompt framing.",
]


def _stable_seed(value: str) -> int:
    """Return a deterministic integer seed for any string value."""

    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


@dataclass(slots=True)
class ProjectContext:
    """Minimal project context passed to provider adapters."""

    project_id: str
    name: str
    source_type: str
    source_notes: str | None
    audio_path: str | None
    audio_filename: str | None
    local_audio_path: str | None


@dataclass(slots=True)
class GenerationResult:
    """Result of the prompt enhancement and audio generation lane."""

    enhanced_prompt: str
    bridge_notes: list[str]
    reference_constraints: list[str]
    message: str
    provider: str
    audio_url: str | None = None
    lyrics_text: str | None = None


@dataclass(slots=True)
class SeparationResult:
    """Result of stem extraction for the studio timeline."""

    stems: list[StemView]
    message: str
    provider: str


@dataclass(slots=True)
class AnalysisResult:
    """Result of musical analysis and generation-to-editing bridge extraction."""

    analysis: AnalysisSummary
    message: str
    provider: str


@dataclass(slots=True)
class LyricsResult:
    """Result of lyric alignment."""

    lyric_excerpt: str
    message: str
    provider: str


@dataclass(slots=True)
class CleanupResult:
    """Result of an audio cleanup and polish pass."""

    polished_audio_filename: str
    polished_audio_path: str
    polished_audio_content_type: str
    message: str
    provider: str


@dataclass(slots=True)
class ProviderStack:
    """Bundle of provider adapters used by the current environment."""

    generation: GenerationProvider
    separation: SeparationProvider
    analysis: AnalysisProvider
    lyrics: LyricsProvider
    cleanup: CleanupProvider


class GenerationProvider:
    """Base interface for prompt enhancement and audio generation."""

    provider_name: str

    def generate(self, context: ProjectContext) -> GenerationResult:
        """Generate a draft and prompt plan for the project."""

        raise NotImplementedError


class SeparationProvider:
    """Base interface for stem extraction."""

    provider_name: str

    def separate(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> SeparationResult:
        """Return stem lanes for the current project."""

        raise NotImplementedError


class AnalysisProvider:
    """Base interface for structure and feature extraction."""

    provider_name: str

    def analyze(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
        lyric_provider_name: str,
    ) -> AnalysisResult:
        """Return structured project analysis."""

        raise NotImplementedError


class LyricsProvider:
    """Base interface for lyric alignment."""

    provider_name: str

    def align(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> LyricsResult:
        """Return lyric alignment summary."""

        raise NotImplementedError


class CleanupProvider:
    """Base interface for cleanup and polish passes."""

    provider_name: str

    def polish(self, context: ProjectContext) -> CleanupResult:
        """Return a polished output for the current project."""

        raise NotImplementedError


class MockAceStepGenerationProvider(GenerationProvider):
    """Demo generation provider for the ACE-Step lane."""

    provider_name = "ace-step-via-fal"

    def generate(self, context: ProjectContext) -> GenerationResult:
        """Return a deterministic prompt-enhanced generation plan."""

        prompt = _prompt_from_context(context)
        enhanced_prompt = (
            "[intro][synth pads][neon atmosphere] "
            f"{prompt} "
            "[verse][airy vocal][driving bass][chorus][wide stereo lift]"
        )
        return GenerationResult(
            enhanced_prompt=enhanced_prompt,
            bridge_notes=[
                "Prompt enhancer translated the request into section-aware ACE tags.",
                "Generated draft is intended to feed stem extraction before editing.",
            ],
            reference_constraints=[
                "Preserve high-energy chorus transition",
                "Keep vocal lane clear for lyric alignment",
            ],
            message="ACE-Step draft prepared for the editing bridge",
            provider=self.provider_name,
            lyrics_text="Neon skyline, hold the line, keep the city singing after midnight.",
        )


class FalAceStepGenerationProvider(GenerationProvider):
    """Real fal-backed ACE-Step generation provider with demo fallback."""

    provider_name = "ace-step-via-fal"

    def __init__(self, api_key: str) -> None:
        """Store the API key for server-side fal calls."""

        self._api_key = api_key

    def generate(self, context: ProjectContext) -> GenerationResult:
        """Generate a hosted ACE-Step draft and return bridge metadata."""

        prompt = _prompt_from_context(context)
        try:
            os.environ["FAL_KEY"] = self._api_key

            import fal_client

            result = fal_client.subscribe(
                FAL_ACE_STEP_APPLICATION,
                arguments={
                    "prompt": prompt,
                    "duration": 30,
                    "number_of_steps": 20,
                    "instrumental": _is_instrumental_prompt(prompt),
                },
                client_timeout=240,
            )
            audio_url = _deep_get(result, "audio", "url")
            if not isinstance(audio_url, str) or not audio_url:
                raise RuntimeError("fal returned no audio URL")

            tags = _string_or_none(result.get("tags"))
            lyrics = _string_or_none(result.get("lyrics"))
            enhanced_prompt = _compose_enhanced_prompt(prompt, tags=tags, lyrics=lyrics)
            return GenerationResult(
                enhanced_prompt=enhanced_prompt,
                bridge_notes=[
                    "fal ACE-Step generated a hosted draft for the editing bridge.",
                    "The hosted WAV is now the source material for downstream stem extraction.",
                ],
                reference_constraints=_constraints_from_tags(tags),
                message="fal ACE-Step draft generated and linked into the session",
                provider=self.provider_name,
                audio_url=audio_url,
                lyrics_text=lyrics,
            )
        except Exception as error:  # pragma: no cover - network fallback
            demo = MockAceStepGenerationProvider().generate(context)
            return GenerationResult(
                enhanced_prompt=demo.enhanced_prompt,
                bridge_notes=demo.bridge_notes,
                reference_constraints=demo.reference_constraints,
                message=f"fal generation unavailable, using bridge-ready demo draft ({error})",
                provider=demo.provider,
                audio_url=demo.audio_url,
                lyrics_text=demo.lyrics_text,
            )


class MockStemSeparationProvider(SeparationProvider):
    """Demo stem provider matching the planned provider routing."""

    def __init__(self, provider_name: str) -> None:
        """Initialize the provider with its runtime name."""

        self.provider_name = provider_name

    def separate(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> SeparationResult:
        """Return a four-stem layout for the current project."""

        stem_audio_path = context.audio_path or (
            generation_result.audio_url if generation_result else None
        )
        return SeparationResult(
            stems=_default_stems(
                context.project_id,
                self.provider_name,
                audio_path=stem_audio_path,
                audio_content_type=_guess_audio_content_type(
                    context.audio_filename,
                    stem_audio_path,
                ),
            ),
            message="Stem lanes are ready for rebalance and region editing",
            provider=self.provider_name,
        )


class AudioShakeStemSeparationProvider(SeparationProvider):
    """AudioShake-backed source separation with demo fallback."""

    provider_name = "audioshake"

    def __init__(self, api_key: str, public_api_url: str) -> None:
        """Store API credentials for task submission and polling."""

        self._api_key = api_key
        self._public_api_url = public_api_url

    def separate(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> SeparationResult:
        """Create a separation task and wait for stem links."""

        try:
            source_payload = self._build_source_payload(
                context,
                generation_result=generation_result,
            )
            task = self._create_task(
                source_payload,
                targets=[
                    {"model": "vocals", "formats": ["wav"]},
                    {"model": "drums", "formats": ["wav"]},
                    {"model": "bass", "formats": ["wav"]},
                    {"model": "instrumental", "formats": ["wav"]},
                ],
                metadata=context.project_id,
            )
            completed_task = self._wait_for_task(task["id"])
            completed_models = [
                str(target.get("model", "unknown"))
                for target in completed_task.get("targets", [])
                if target.get("status") == "completed"
            ]
            stem_audio_path = context.audio_path or (
                generation_result.audio_url if generation_result else None
            )
            extracted_stems = _extract_stems_from_task(
                context.project_id,
                self.provider_name,
                completed_task,
            )
            return SeparationResult(
                stems=extracted_stems
                or _default_stems(
                    context.project_id,
                    self.provider_name,
                    audio_path=stem_audio_path,
                    audio_content_type=_guess_audio_content_type(
                        context.audio_filename,
                        stem_audio_path,
                    ),
                ),
                message=(
                    "AudioShake completed stem separation for "
                    f"{', '.join(completed_models) or 'requested targets'}"
                ),
                provider=self.provider_name,
            )
        except Exception as error:  # pragma: no cover - network fallback
            fallback_audio_path = context.audio_path or (
                generation_result.audio_url if generation_result else None
            )
            return SeparationResult(
                stems=_default_stems(
                    context.project_id,
                    self.provider_name,
                    audio_path=fallback_audio_path,
                    audio_content_type=_guess_audio_content_type(
                        context.audio_filename,
                        fallback_audio_path,
                    ),
                ),
                message=f"AudioShake unavailable, using demo stems ({error})",
                provider=self.provider_name,
            )

    def _build_source_payload(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> dict[str, str]:
        """Resolve the best available source for AudioShake tasks."""

        if (
            context.audio_path
            and context.audio_path.startswith("/media/")
            and _is_public_host(self._public_api_url)
        ):
            return {"url": f"{self._public_api_url}{context.audio_path}"}
        if generation_result and generation_result.audio_url:
            return {"url": generation_result.audio_url}
        if context.local_audio_path:
            asset_id = self._upload_asset(
                Path(context.local_audio_path),
                filename=context.audio_filename or f"{context.project_id}.wav",
            )
            return {"assetId": asset_id}
        if context.audio_path and context.audio_path.startswith(("http://", "https://")):
            return {"url": context.audio_path}
        raise ValueError("No audio source is available for AudioShake separation")

    def _upload_asset(self, file_path: Path, *, filename: str) -> str:
        """Upload a local file and return the created AudioShake asset id."""

        content_type = mimetypes.guess_type(filename)[0] or "audio/wav"
        with file_path.open("rb") as file_handle, httpx.Client(timeout=120) as client:
            response = client.post(
                f"{AUDIO_SHAKE_BASE_URL}/assets",
                headers={"x-api-key": self._api_key},
                files={"file": (filename, file_handle, content_type)},
            )
            response.raise_for_status()
            payload = response.json()
        asset_id = payload.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            raise RuntimeError("AudioShake asset upload returned no id")
        return asset_id

    def _create_task(
        self,
        source_payload: dict[str, str],
        *,
        targets: list[dict[str, Any]],
        metadata: str,
    ) -> dict[str, Any]:
        """Submit a task to AudioShake and return its initial payload."""

        with httpx.Client(timeout=45) as client:
            response = client.post(
                f"{AUDIO_SHAKE_BASE_URL}/tasks",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self._api_key,
                },
                json={**source_payload, "targets": targets, "metadata": metadata},
            )
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict) or "id" not in payload:
            raise RuntimeError("AudioShake task submission returned an unexpected payload")
        return payload

    def _wait_for_task(self, task_id: str) -> dict[str, Any]:
        """Poll the AudioShake task until completion or error."""

        with httpx.Client(timeout=45) as client:
            for _ in range(40):
                response = client.get(
                    f"{AUDIO_SHAKE_BASE_URL}/tasks/{task_id}",
                    headers={"x-api-key": self._api_key},
                )
                response.raise_for_status()
                payload = response.json()
                targets = payload.get("targets", [])
                if not isinstance(targets, list) or not targets:
                    raise RuntimeError("AudioShake task returned no targets")

                statuses = [str(target.get("status", "")) for target in targets]
                if all(status == "completed" for status in statuses):
                    if not isinstance(payload, dict):
                        raise RuntimeError("AudioShake task returned an invalid payload")
                    return payload
                if any(status == "error" for status in statuses):
                    message = "; ".join(_target_error_messages(targets))
                    raise RuntimeError(message or "AudioShake returned a target error")
                time.sleep(3)
        raise TimeoutError("AudioShake task timed out")


class MockAnalysisProvider(AnalysisProvider):
    """Demo analysis provider for the generation-to-editing bridge."""

    def __init__(self, provider_name: str) -> None:
        """Initialize the provider with its runtime name."""

        self.provider_name = provider_name

    def analyze(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
        lyric_provider_name: str,
    ) -> AnalysisResult:
        """Return deterministic structured project analysis."""

        seed = _stable_seed(context.project_id)
        random = Random(seed)
        chord_sets = [
            ["Am7", "Fmaj7", "C", "G"],
            ["Dm9", "G13", "Cmaj7", "A7"],
            ["Em", "C", "G", "D"],
        ]
        bpm = round(random.uniform(92.0, 128.0), 1)
        musical_key = random.choice(["A minor", "C major", "E minor", "F# minor"])
        chord_progression = random.choice(chord_sets)
        key_confidence = round(random.uniform(0.55, 0.82), 2)
        transient_strength = round(random.uniform(0.09, 0.18), 2)
        arrangement_notes = [
            "Verse is tighter than chorus and could support region replace.",
            "Bridge feels like the strongest candidate for generative extension.",
            "Vocal phrasing is clean enough for quick lyric correction.",
        ]
        if generation_result:
            arrangement_notes.insert(
                0,
                "ACE generation produced a draft before the editing bridge activated.",
            )
        reference_constraints = (
            generation_result.reference_constraints
            if generation_result
            else [
                "Maintain uploaded groove before experimental edits",
                "Keep transient clarity for MIDI extraction",
            ]
        )
        analysis = AnalysisSummary(
            bpm=bpm,
            musical_key=musical_key,
            chord_progression=chord_progression,
            lyric_excerpt=(
                f"Lyrics aligned with {lyric_provider_name}; ready for timestamp "
                "correction and phrase-level edits."
            ),
            midi_ready=True,
            arrangement_notes=arrangement_notes[:3],
            engine_mode=(
                "ace-generate-edit"
                if context.source_type in {"prompt", "reference"}
                else "upload-first"
            ),
            enhanced_prompt=generation_result.enhanced_prompt if generation_result else None,
            reference_constraints=reference_constraints,
            bridge_notes=(
                generation_result.bridge_notes
                if generation_result
                else ["Upload-first path sends extracted features directly into the edit layer."]
            ),
            sections=[
                ArrangementSection(
                    label="Intro",
                    start_bar=1,
                    end_bar=4,
                    energy="low",
                    summary="Sparse opening space that leaves headroom for transition edits.",
                ),
                ArrangementSection(
                    label="Verse",
                    start_bar=5,
                    end_bar=12,
                    energy="medium",
                    summary="Main body carries the groove and reads as the cleanest edit target.",
                ),
                ArrangementSection(
                    label="Chorus",
                    start_bar=13,
                    end_bar=16,
                    energy="high",
                    summary="Lift section with the strongest payoff and widest arrangement bloom.",
                ),
            ],
            critic=_build_critic_scores(
                bpm=bpm,
                key_confidence=key_confidence,
                transient_strength=transient_strength,
                chord_progression=chord_progression,
                arrangement_notes=arrangement_notes[:3],
                midi_ready=True,
                generated=generation_result is not None,
            ),
            provider=self.provider_name,
        )
        return AnalysisResult(
            analysis=analysis,
            message="Bridge features extracted for editing and direction layers",
            provider=self.provider_name,
        )


class LocalAudioAnalysisProvider(AnalysisProvider):
    """Compute real BPM, key, chords, and arrangement notes from project audio."""

    provider_name = "local-spectral-analysis"

    def __init__(self, public_api_url: str) -> None:
        """Store the public API URL for any temporary remote fetches."""

        self._public_api_url = public_api_url.rstrip("/")

    def analyze(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
        lyric_provider_name: str,
    ) -> AnalysisResult:
        """Analyze the best available project audio and return structured features."""

        try:
            source_path, temp_dir = self._resolve_source_path(
                context,
                generation_result=generation_result,
            )
            try:
                computed = analyze_audio_file(source_path)
            finally:
                if temp_dir is not None:
                    temp_dir.cleanup()
        except Exception as error:  # pragma: no cover - defensive fallback
            demo = MockAnalysisProvider(self.provider_name).analyze(
                context,
                generation_result=generation_result,
                lyric_provider_name=lyric_provider_name,
            )
            return AnalysisResult(
                analysis=demo.analysis,
                message=f"Real audio analysis unavailable, using structured fallback ({error})",
                provider=self.provider_name,
            )

        arrangement_notes = computed.arrangement_notes
        if generation_result and arrangement_notes:
            arrangement_notes = [
                "Generated draft was analyzed as real audio before entering the editor.",
                *arrangement_notes,
            ]

        analysis = AnalysisSummary(
            bpm=computed.bpm,
            musical_key=computed.musical_key,
            chord_progression=computed.chord_progression,
            lyric_excerpt=(
                f"Lyric alignment is being refreshed by {lyric_provider_name}; "
                "review phrase timing in the workspace."
            ),
            midi_ready=computed.midi_ready,
            arrangement_notes=arrangement_notes[:4],
            engine_mode=(
                "ace-generate-edit"
                if context.source_type in {"prompt", "reference"}
                else "upload-first"
            ),
            enhanced_prompt=generation_result.enhanced_prompt if generation_result else None,
            reference_constraints=(
                generation_result.reference_constraints
                if generation_result
                else [
                    "Preserve transient clarity for MIDI extraction.",
                    "Keep harmonic edits anchored to the detected key center.",
                ]
            ),
            bridge_notes=(
                [
                    *generation_result.bridge_notes,
                    "Audio-derived tempo, key, and chord cues are now feeding editor suggestions.",
                ]
                if generation_result
                else [
                    "Upload-first analysis extracted real tempo, harmonic, and arrangement cues.",
                    "These features are now ready to guide timeline edits and MIDI generation.",
                ]
            ),
            sections=[
                ArrangementSection(
                    label=section.label,
                    start_bar=section.start_bar,
                    end_bar=section.end_bar,
                    energy=section.energy,
                    summary=section.summary,
                )
                for section in computed.sections
            ],
            critic=_build_critic_scores(
                bpm=computed.bpm,
                key_confidence=computed.key_confidence,
                transient_strength=computed.transient_strength,
                chord_progression=computed.chord_progression,
                arrangement_notes=arrangement_notes,
                midi_ready=computed.midi_ready,
                generated=generation_result is not None,
            ),
            provider=self.provider_name,
        )
        return AnalysisResult(
            analysis=analysis,
            message=("Real BPM, key, chord, and arrangement analysis completed from source audio"),
            provider=self.provider_name,
        )

    def _resolve_source_path(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
        """Resolve a local file path for analysis, downloading remote audio when required."""

        if context.local_audio_path:
            candidate = Path(context.local_audio_path)
            if candidate.exists():
                return candidate, None

        source_url: str | None = None
        if context.audio_path and context.audio_path.startswith(("http://", "https://")):
            source_url = context.audio_path
        elif (
            context.audio_path
            and context.audio_path.startswith("/media/")
            and _is_public_host(self._public_api_url)
        ):
            source_url = f"{self._public_api_url}{context.audio_path}"
        elif generation_result and generation_result.audio_url:
            source_url = generation_result.audio_url

        if not source_url:
            raise ValueError("No analyzable audio source is available for this project")

        temp_dir = tempfile.TemporaryDirectory()
        suffix = Path(source_url).suffix or ".wav"
        temp_path = Path(temp_dir.name) / f"{context.project_id}{suffix}"
        with httpx.stream("GET", source_url, follow_redirects=True, timeout=180) as response:
            response.raise_for_status()
            with temp_path.open("wb") as file_handle:
                for chunk in response.iter_bytes():
                    file_handle.write(chunk)
        return temp_path, temp_dir


class MockLyricsProvider(LyricsProvider):
    """Demo lyrics provider."""

    def __init__(self, provider_name: str) -> None:
        """Initialize the provider with its runtime name."""

        self.provider_name = provider_name

    def align(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> LyricsResult:
        """Return a compact lyric alignment summary."""

        if generation_result and generation_result.lyrics_text:
            excerpt = generation_result.lyrics_text
        elif generation_result:
            excerpt = "Neon skyline, hold the line, keep the city singing after midnight."
        else:
            excerpt = "Uploaded vocal line aligned for phrase-level timing edits."
        return LyricsResult(
            lyric_excerpt=excerpt,
            message="Lyric timeline is ready for edits and subtitle export",
            provider=self.provider_name,
        )


class AudioShakeLyricsProvider(AudioShakeStemSeparationProvider, LyricsProvider):
    """AudioShake transcription provider with demo fallback."""

    provider_name = "audioshake-transcription"

    def align(
        self,
        context: ProjectContext,
        *,
        generation_result: GenerationResult | None,
    ) -> LyricsResult:
        """Transcribe lyrics from the best available project audio."""

        try:
            source_payload = self._build_source_payload(
                context,
                generation_result=generation_result,
            )
            task = self._create_task(
                source_payload,
                targets=[{"model": "transcription", "formats": ["json"]}],
                metadata=f"{context.project_id}:lyrics",
            )
            completed_task = self._wait_for_task(task["id"])
            transcript_url = _find_transcript_url(completed_task)
            excerpt = _extract_excerpt_from_transcript_url(transcript_url)
            return LyricsResult(
                lyric_excerpt=excerpt,
                message="AudioShake lyric transcription is ready for review",
                provider=self.provider_name,
            )
        except Exception as error:  # pragma: no cover - network fallback
            demo = MockLyricsProvider(self.provider_name).align(
                context,
                generation_result=generation_result,
            )
            return LyricsResult(
                lyric_excerpt=demo.lyric_excerpt,
                message=f"AudioShake transcription unavailable, using demo lyrics ({error})",
                provider=self.provider_name,
            )


class MockCleanupProvider(CleanupProvider):
    """Demo cleanup provider that points back to the current source audio."""

    def __init__(self, provider_name: str) -> None:
        """Initialize the provider with its runtime name."""

        self.provider_name = provider_name

    def polish(self, context: ProjectContext) -> CleanupResult:
        """Return the best available project audio as a mock polished result."""

        if not context.audio_path:
            raise ValueError("No audio is available for a cleanup pass")
        filename = context.audio_filename or f"{context.project_id}-preview.wav"
        content_type = mimetypes.guess_type(filename)[0] or "audio/wav"
        return CleanupResult(
            polished_audio_filename=filename,
            polished_audio_path=context.audio_path,
            polished_audio_content_type=content_type,
            message="Demo cleanup pass completed using the current project audio",
            provider=self.provider_name,
        )


class AuphonicCleanupProvider(CleanupProvider):
    """Auphonic-backed cleanup and loudness finishing provider."""

    provider_name = "auphonic"

    def __init__(self, api_key: str, public_api_url: str) -> None:
        """Store the API key and public API URL for source resolution."""

        self._api_key = api_key
        self._public_api_url = public_api_url.rstrip("/")

    def polish(self, context: ProjectContext) -> CleanupResult:
        """Run a cleanup pass through Auphonic and return the polished output."""

        with httpx.Client(timeout=60) as client:
            production_uuid = self._create_production(client, context)
            self._start_production(client, production_uuid)
            self._wait_for_production(client, production_uuid)
            detail = self._get_production_detail(client, production_uuid)

        output_files = detail.get("output_files", [])
        if not isinstance(output_files, list) or not output_files:
            raise RuntimeError("Auphonic returned no output files")

        for output_file in output_files:
            if not isinstance(output_file, dict):
                continue
            download_url = output_file.get("download_url")
            filename = output_file.get("filename")
            ending = output_file.get("ending")
            if isinstance(download_url, str) and isinstance(filename, str):
                content_type = mimetypes.guess_type(filename)[0] or _content_type_from_ending(
                    ending
                )
                return CleanupResult(
                    polished_audio_filename=filename,
                    polished_audio_path=download_url,
                    polished_audio_content_type=content_type,
                    message="Auphonic cleanup and loudness polish completed",
                    provider=self.provider_name,
                )
        raise RuntimeError("Auphonic returned output files without a downloadable asset")

    def _create_production(
        self,
        client: httpx.Client,
        context: ProjectContext,
    ) -> str:
        """Create a production and return its UUID."""

        headers = {
            "Authorization": f"bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        source_url = self._build_source_url(context)
        payload: dict[str, Any] = {
            "metadata": {"title": f"{context.name} Polish Pass"},
            "output_basename": f"{context.project_id}-polished",
            "output_files": [{"format": "mp3", "bitrate": "128"}],
            "algorithms": {
                "filtering": True,
                "leveler": True,
                "normloudness": True,
                "denoise": True,
                "denoiseamount": 12,
                "loudnesstarget": -14,
            },
        }
        if source_url:
            payload["input_file"] = source_url

        response = client.post(
            "https://auphonic.com/api/productions.json",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json().get("data", {})
        production_uuid = data.get("uuid")
        if not isinstance(production_uuid, str) or not production_uuid:
            raise RuntimeError("Auphonic production creation returned no UUID")

        if source_url is None:
            self._upload_local_file(client, production_uuid, context)
        return production_uuid

    def _upload_local_file(
        self,
        client: httpx.Client,
        production_uuid: str,
        context: ProjectContext,
    ) -> None:
        """Upload a local file into an existing Auphonic production."""

        if not context.local_audio_path:
            raise ValueError("No local audio file is available for upload")

        filename = context.audio_filename or f"{context.project_id}.wav"
        content_type = mimetypes.guess_type(filename)[0] or "audio/wav"
        with Path(context.local_audio_path).open("rb") as file_handle:
            response = client.post(
                f"https://auphonic.com/api/production/{production_uuid}/upload.json",
                headers={"Authorization": f"bearer {self._api_key}"},
                files={"input_file": (filename, file_handle, content_type)},
            )
        response.raise_for_status()

    def _build_source_url(self, context: ProjectContext) -> str | None:
        """Build the best externally reachable source URL for Auphonic."""

        if context.audio_path and context.audio_path.startswith(("http://", "https://")):
            return context.audio_path
        if (
            context.audio_path
            and context.audio_path.startswith("/media/")
            and _is_public_host(self._public_api_url)
        ):
            return f"{self._public_api_url}{context.audio_path}"
        return None

    def _start_production(self, client: httpx.Client, production_uuid: str) -> None:
        """Start an existing production."""

        response = client.post(
            f"https://auphonic.com/api/production/{production_uuid}/start.json",
            headers={"Authorization": f"bearer {self._api_key}"},
        )
        response.raise_for_status()

    def _wait_for_production(
        self,
        client: httpx.Client,
        production_uuid: str,
    ) -> None:
        """Poll the production until completion or error."""

        for _ in range(40):
            response = client.get(
                f"https://auphonic.com/api/production/{production_uuid}/status.json",
                headers={"Authorization": f"bearer {self._api_key}"},
            )
            response.raise_for_status()
            status_payload = response.json().get("data", {})
            status_string = status_payload.get("status_string")
            if status_string == "Done":
                return
            if status_string == "Error":
                raise RuntimeError(
                    str(status_payload.get("error_message") or "Auphonic reported an error")
                )
            time.sleep(3)
        raise TimeoutError("Auphonic polish pass timed out")

    def _get_production_detail(
        self,
        client: httpx.Client,
        production_uuid: str,
    ) -> dict[str, Any]:
        """Fetch the final production detail payload."""

        response = client.get(
            f"https://auphonic.com/api/production/{production_uuid}.json",
            headers={"Authorization": f"bearer {self._api_key}"},
        )
        response.raise_for_status()
        payload = response.json().get("data", {})
        if not isinstance(payload, dict):
            raise RuntimeError("Auphonic detail payload is invalid")
        return payload


def build_provider_stack(settings: Settings) -> ProviderStack:
    """Construct the provider stack for the current environment."""

    return ProviderStack(
        generation=(
            FalAceStepGenerationProvider(settings.fal_key)
            if settings.fal_key
            else MockAceStepGenerationProvider()
        ),
        separation=(
            AudioShakeStemSeparationProvider(
                settings.audio_provider_api_key,
                settings.public_api_url,
            )
            if settings.audio_provider_api_key
            else MockStemSeparationProvider(settings.audio_provider)
        ),
        analysis=LocalAudioAnalysisProvider(settings.public_api_url),
        lyrics=(
            AudioShakeLyricsProvider(
                settings.audio_provider_api_key,
                settings.public_api_url,
            )
            if settings.audio_provider_api_key
            else MockLyricsProvider(settings.lyrics_provider)
        ),
        cleanup=(
            AuphonicCleanupProvider(
                settings.cleanup_provider_api_key,
                settings.public_api_url,
            )
            if settings.cleanup_provider_api_key
            else MockCleanupProvider(settings.cleanup_provider)
        ),
    )


def build_demo_provider_stack(settings: Settings) -> ProviderStack:
    """Construct a zero-cost demo provider stack for seeded content."""

    return ProviderStack(
        generation=MockAceStepGenerationProvider(),
        separation=MockStemSeparationProvider(settings.audio_provider),
        analysis=MockAnalysisProvider(settings.analysis_provider),
        lyrics=MockLyricsProvider(settings.lyrics_provider),
        cleanup=MockCleanupProvider(settings.cleanup_provider),
    )


def _default_stems(
    project_id: str,
    provider_name: str,
    *,
    audio_path: str | None = None,
    audio_content_type: str | None = None,
) -> list[StemView]:
    """Return the default four-stem layout for the studio timeline."""

    return [
        StemView(
            id=f"{project_id}_stem_vocal",
            name="Lead Vocal",
            kind="vocal",
            color="#f97316",
            level_db=-1.5,
            audio_path=audio_path,
            audio_content_type=audio_content_type,
            provider=provider_name,
        ),
        StemView(
            id=f"{project_id}_stem_drums",
            name="Drums",
            kind="drums",
            color="#0f9d7a",
            level_db=-2.0,
            audio_path=audio_path,
            audio_content_type=audio_content_type,
            provider=provider_name,
        ),
        StemView(
            id=f"{project_id}_stem_bass",
            name="Bass",
            kind="bass",
            color="#2563eb",
            level_db=-3.0,
            audio_path=audio_path,
            audio_content_type=audio_content_type,
            provider=provider_name,
        ),
        StemView(
            id=f"{project_id}_stem_music",
            name="Music Bed",
            kind="instrumental",
            color="#7c3aed",
            level_db=-1.0,
            audio_path=audio_path,
            audio_content_type=audio_content_type,
            provider=provider_name,
        ),
    ]


def _extract_stems_from_task(
    project_id: str,
    provider_name: str,
    task_payload: dict[str, Any],
) -> list[StemView]:
    """Build stem views from a completed AudioShake task payload when URLs are available."""

    targets = task_payload.get("targets", [])
    if not isinstance(targets, list):
        return []

    stems: list[StemView] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        model = _string_or_none(target.get("model"))
        if not model:
            continue

        stem_blueprint = _stem_blueprint_for_model(model)
        if stem_blueprint is None:
            continue

        audio_url = _find_target_audio_url(target)
        stems.append(
            StemView(
                id=f"{project_id}_stem_{stem_blueprint['kind']}",
                name=stem_blueprint["name"],
                kind=stem_blueprint["kind"],
                color=stem_blueprint["color"],
                level_db=stem_blueprint["level_db"],
                audio_path=audio_url,
                audio_content_type=_guess_audio_content_type(None, audio_url),
                provider=provider_name,
            )
        )
    return stems


def _stem_blueprint_for_model(model_name: str) -> dict[str, Any] | None:
    """Map provider model names to the workspace stem presentation."""

    model_key = model_name.strip().lower()
    mapping: dict[str, dict[str, Any]] = {
        "vocals": {
            "name": "Lead Vocal",
            "kind": "vocal",
            "color": "#f97316",
            "level_db": -1.5,
        },
        "drums": {
            "name": "Drums",
            "kind": "drums",
            "color": "#0f9d7a",
            "level_db": -2.0,
        },
        "bass": {
            "name": "Bass",
            "kind": "bass",
            "color": "#2563eb",
            "level_db": -3.0,
        },
        "instrumental": {
            "name": "Music Bed",
            "kind": "instrumental",
            "color": "#7c3aed",
            "level_db": -1.0,
        },
        "other": {
            "name": "Music Bed",
            "kind": "instrumental",
            "color": "#7c3aed",
            "level_db": -1.0,
        },
    }
    return mapping.get(model_key)


def _find_target_audio_url(target: dict[str, Any]) -> str | None:
    """Resolve the best playable audio URL from one provider target payload."""

    direct_url = _string_or_none(target.get("downloadUrl")) or _string_or_none(target.get("url"))
    if direct_url:
        return direct_url

    output = target.get("output", [])
    if not isinstance(output, list):
        return None

    for item in output:
        if not isinstance(item, dict):
            continue
        link = _string_or_none(item.get("link")) or _string_or_none(item.get("url"))
        if not link:
            continue
        item_format = _string_or_none(item.get("format")) or Path(link).suffix.removeprefix(".")
        if item_format.lower() in {"wav", "mp3", "flac", "m4a", "aac", "aiff"}:
            return link
    return None


def _prompt_from_context(context: ProjectContext) -> str:
    """Build the strongest prompt available from project context."""

    return _enhance_prompt_text(_extract_prompt_intent(context))


def _extract_prompt_intent(context: ProjectContext) -> str:
    """Extract the creative prompt from a project context without metadata noise."""

    if context.source_notes:
        prompt_match = re.search(r"Prompt:\s*([^|]+)", context.source_notes, flags=re.IGNORECASE)
        if prompt_match:
            return prompt_match.group(1).strip()
        reference_match = re.search(
            r"Reference URL:\s*([^|]+)",
            context.source_notes,
            flags=re.IGNORECASE,
        )
        if reference_match:
            return (
                "Create a track guided by this reference while staying original: "
                f"{reference_match.group(1).strip()}"
            )
        cleaned = context.source_notes.strip()
        if cleaned:
            return cleaned
    return context.name


def build_refined_prompt(
    *,
    base_prompt: str,
    critic: CriticScores | None,
    previous_enhanced_prompt: str | None,
    iteration: int,
) -> tuple[str, str]:
    """Return a rewritten prompt and a short rewrite brief for the next iteration."""

    suggestions = critic.notes if critic else []
    rewrite_focus: list[str] = []
    if critic:
        if critic.fidelity < 7.8:
            rewrite_focus.append("bring the result closer to the original intent and hook")
        if critic.quality < 7.8:
            rewrite_focus.append("strengthen melody, harmony, and section contrast")
        if critic.emotion < 7.8:
            rewrite_focus.append("increase emotional lift and memorable payoff")
        if critic.production < 7.8:
            rewrite_focus.append("clarify arrangement layers and improve mix balance")
        if critic.technical < 7.8:
            rewrite_focus.append("reduce technical risk such as clipping, masking, or harshness")

    if not rewrite_focus:
        rewrite_focus.append("tighten the arrangement while preserving the strongest ideas")

    rewrite_brief = f"Iteration {iteration + 1} rewrite: " + "; ".join(rewrite_focus[:3]) + "."
    enriched_prompt = " ".join(
        [
            base_prompt.strip(),
            rewrite_brief,
            "Refinement targets:",
            " ".join(suggestions[:2]) if suggestions else "improve musical clarity and fidelity.",
            f"Previous enhanced prompt anchor: {previous_enhanced_prompt}"
            if previous_enhanced_prompt
            else "",
        ]
    ).strip()
    return enriched_prompt, rewrite_brief


def _compose_enhanced_prompt(
    prompt: str,
    *,
    tags: str | None,
    lyrics: str | None,
) -> str:
    """Format the prompt, tags, and lyrics into one readable string."""

    parts = [prompt]
    if tags:
        parts.append(f"tags: {tags}")
    if lyrics:
        parts.append(f"lyrics: {lyrics}")
    return " | ".join(parts)


def _enhance_prompt_text(prompt: str) -> str:
    """Turn casual language into a more structured ACE-style instruction."""

    prompt_lower = prompt.lower()
    moods = _match_prompt_terms(
        prompt_lower,
        {
            "cinematic": ["cinematic", "epic", "score", "soundtrack"],
            "moody": ["moody", "dark", "late-night", "night", "brooding"],
            "uplifting": ["uplifting", "anthemic", "euphoric", "hopeful"],
            "warm": ["warm", "organic", "cozy", "intimate"],
            "aggressive": ["aggressive", "hard", "heavy", "edgy"],
        },
    )
    styles = _match_prompt_terms(
        prompt_lower,
        {
            "synth-pop": ["synth", "synth-pop", "dream-pop", "electro-pop"],
            "house": ["house", "club", "dance", "four-on-the-floor"],
            "hip-hop": ["hip-hop", "trap", "808", "rap"],
            "indie": ["indie", "band", "guitar", "lo-fi"],
            "ambient": ["ambient", "drone", "meditative", "atmospheric"],
        },
    )
    vocals = _match_prompt_terms(
        prompt_lower,
        {
            "airy vocal": ["airy vocal", "soft female vocal", "breathy", "dreamy vocal"],
            "lead rap": ["rap", "spoken", "bars"],
            "choir textures": ["choir", "stacked vocals", "harmony"],
            "instrumental": ["instrumental", "no vocals"],
        },
    )
    arrangement = _match_prompt_terms(
        prompt_lower,
        {
            "intro": ["intro", "opening"],
            "verse": ["verse"],
            "chorus": ["chorus", "hook", "drop"],
            "bridge": ["bridge", "middle eight"],
            "outro": ["outro", "ending", "finale"],
        },
    )

    if "intro" not in arrangement:
        arrangement.insert(0, "intro")
    if "verse" not in arrangement:
        arrangement.append("verse")
    if "chorus" not in arrangement:
        arrangement.append("chorus")
    if "outro" not in arrangement:
        arrangement.append("outro")

    descriptor_tokens = [*moods[:2], *styles[:2], *vocals[:2]]
    descriptor_tags = "".join(f"[{token}]" for token in descriptor_tokens)
    arrangement_tags = "".join(f"[{section}]" for section in arrangement[:4])
    lyric_hint = (
        "lyrics: compact, memorable hook with one vivid image per section"
        if "instrumental" not in vocals
        else "lyrics: instrumental arrangement, no lead vocal"
    )
    return f"{arrangement_tags}{descriptor_tags} {prompt.strip()} | {lyric_hint}"


def _match_prompt_terms(prompt: str, mapping: dict[str, list[str]]) -> list[str]:
    """Collect tagged descriptors from one prompt by keyword match."""

    matches: list[str] = []
    for label, keywords in mapping.items():
        if any(keyword in prompt for keyword in keywords):
            matches.append(label)
    return matches


def _constraints_from_tags(tags: str | None) -> list[str]:
    """Create simple edit constraints from model-returned tags."""

    if not tags:
        return [
            "Preserve high-energy chorus transition",
            "Keep vocal lane clear for lyric alignment",
        ]

    parsed = [tag.strip() for tag in tags.split(",") if tag.strip()]
    constraints = [f"Keep the {tag} identity intact during editing" for tag in parsed[:2]]
    return constraints or [
        "Preserve high-energy chorus transition",
        "Keep vocal lane clear for lyric alignment",
    ]


def _is_instrumental_prompt(prompt: str) -> bool:
    """Infer whether the prompt is explicitly asking for an instrumental."""

    prompt_lower = prompt.lower()
    return "instrumental" in prompt_lower or "no vocals" in prompt_lower


def _guess_audio_content_type(filename: str | None, audio_path: str | None) -> str | None:
    """Infer one content type for a playable audio asset."""

    candidate = filename or audio_path
    if not candidate:
        return None
    return mimetypes.guess_type(candidate)[0] or None


def _build_critic_scores(
    *,
    bpm: float,
    key_confidence: float,
    transient_strength: float,
    chord_progression: list[str],
    arrangement_notes: list[str],
    midi_ready: bool,
    generated: bool,
) -> CriticScores:
    """Return a lightweight five-axis critic summary for the current analysis."""

    fidelity = min(9.4, 6.6 + key_confidence * 2.4 + (0.3 if generated else 0.0))
    quality = min(9.5, 6.8 + min(transient_strength, 0.25) * 8.0)
    emotion = min(
        9.2,
        6.5 + (0.9 if len(arrangement_notes) >= 3 else 0.4) + (0.4 if generated else 0.0),
    )
    production = min(
        9.1,
        6.7 + (0.8 if 96 <= bpm <= 140 else 0.4) + min(len(chord_progression), 3) * 0.3,
    )
    technical = min(
        9.4,
        6.6 + (0.8 if midi_ready else 0.2) + (0.8 if len(chord_progression) >= 2 else 0.3),
    )
    average = round((fidelity + quality + emotion + production + technical) / 5, 1)

    if average >= 8.2:
        verdict = "Strong draft"
    elif average >= 7.5:
        verdict = "Promising, needs targeted edits"
    else:
        verdict = "Refine before committing"

    notes: list[str] = []
    if key_confidence < 0.55:
        notes.append("Harmonic center is still soft, so pitch edits should stay conservative.")
    if transient_strength < 0.12:
        notes.append("Transient detail is muted; cleanup or stem-first editing may help.")
    if len(chord_progression) < 2:
        notes.append("Structure reads as thin, so a stronger section contrast could help.")
    if not notes:
        notes.append("Analysis reads cleanly enough to move into region edits and export prep.")

    return CriticScores(
        fidelity=round(fidelity, 1),
        quality=round(quality, 1),
        emotion=round(emotion, 1),
        production=round(production, 1),
        technical=round(technical, 1),
        average=average,
        verdict=verdict,
        notes=notes,
    )


def _string_or_none(value: Any) -> str | None:
    """Normalize a string-like value and drop empty strings."""

    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _deep_get(payload: Any, *keys: str) -> Any:
    """Safely traverse nested dictionaries."""

    current = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _target_error_messages(targets: list[Any]) -> list[str]:
    """Extract readable error messages from task targets."""

    messages: list[str] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        error = target.get("error")
        if isinstance(error, dict) and error.get("message"):
            messages.append(str(error["message"]))
    return messages


def _find_transcript_url(task_payload: dict[str, Any]) -> str:
    """Resolve a transcript URL from an AudioShake task payload."""

    targets = task_payload.get("targets", [])
    if not isinstance(targets, list):
        raise RuntimeError("AudioShake returned an unexpected transcription payload")

    for target in targets:
        if not isinstance(target, dict):
            continue
        transcript_url = target.get("transcriptUrl")
        if isinstance(transcript_url, str) and transcript_url:
            return transcript_url
        output = target.get("output", [])
        if isinstance(output, list):
            for item in output:
                if isinstance(item, dict) and isinstance(item.get("link"), str):
                    return str(item["link"])
    raise RuntimeError("AudioShake returned no transcript URL")


def _extract_excerpt_from_transcript_url(transcript_url: str) -> str:
    """Download a transcript JSON file and return a short excerpt."""

    response = httpx.get(transcript_url, timeout=45)
    response.raise_for_status()
    payload = response.json()
    excerpt = _extract_excerpt_from_payload(payload)
    if excerpt:
        return excerpt
    return "Transcription completed, but no readable excerpt was extracted."


def _extract_excerpt_from_payload(payload: Any) -> str | None:
    """Extract human-readable text from common transcript payload shapes."""

    if isinstance(payload, dict):
        for key in ("text", "transcript", "lyrics"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:220]
        for key in ("segments", "lines", "words", "items"):
            value = payload.get(key)
            excerpt = _extract_excerpt_from_payload(value)
            if excerpt:
                return excerpt
    if isinstance(payload, list):
        parts: list[str] = []
        for item in payload:
            if isinstance(item, dict):
                text = item.get("text") or item.get("word") or item.get("line")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
            if len(" ".join(parts)) >= 160:
                break
        excerpt = " ".join(parts).strip()
        return excerpt[:220] if excerpt else None
    return None


def _content_type_from_ending(ending: Any) -> str:
    """Infer a content type from an output filename ending."""

    if isinstance(ending, str):
        guessed = mimetypes.guess_type(f"output.{ending}")[0]
        if guessed:
            return guessed
    return "audio/mpeg"


def _is_public_host(url: str) -> bool:
    """Return whether a configured API URL is plausibly public."""

    return not any(token in url for token in ("127.0.0.1", "localhost", "0.0.0.0"))
