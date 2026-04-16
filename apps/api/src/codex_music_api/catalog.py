from __future__ import annotations

from typing import TYPE_CHECKING

from codex_music_api.schemas import (
    AccessRequirement,
    ArchitectureComponent,
    ArchitectureLane,
    ArchitecturePlanResponse,
    CapabilityCatalogResponse,
    DeploymentReadinessResponse,
    ImplementationPhase,
    StackChoice,
)

if TYPE_CHECKING:
    from codex_music_api.settings import Settings


def build_capability_catalog(settings: Settings) -> CapabilityCatalogResponse:
    """Return the finalized product stack and phased implementation plan."""

    return CapabilityCatalogResponse(
        application="Codex Music",
        target_surface="Deployable web studio with cloud-orchestrated AI audio workflows",
        deployment_targets=[
            "Next.js website on Vercel",
            "FastAPI API on Vercel for the live hosted preview",
            "SQLite and local media in developer mode",
            "Postgres and S3/R2 in production mode",
        ],
        core_objects=[
            "Project",
            "Track",
            "Stem",
            "Region",
            "Tempo map",
            "Chord layer",
            "Lyric layer",
            "MIDI layer",
            "Rights metadata",
            "Edit history",
        ],
        must_build=[
            "Studio shell and project graph",
            "Non-destructive multitrack editing surface",
            "AI command orchestration layer",
            "Version compare and approvals",
            "Rights-aware export gating",
            "Provider routing and quality controls",
        ],
        provider_capabilities=[
            StackChoice(
                capability="Ingest and transcode",
                selected_component="FFmpeg backend plus ffmpeg.wasm for browser helpers",
                runtime="api",
                stage="now",
                reason="Fastest route to universal audio support without custom codec work.",
                fallback_component="CloudConvert or managed media pipeline",
            ),
            StackChoice(
                capability="Waveform and spectrogram",
                selected_component="wavesurfer.js plus Web Audio API",
                runtime="browser",
                stage="now",
                reason="Best web-first foundation for timeline playback and waveform UI.",
                fallback_component="Native audio element fallback",
            ),
            StackChoice(
                capability="Realtime collaboration",
                selected_component="Yjs",
                runtime="browser",
                stage="next",
                reason="Strong CRDT option once multi-user timeline editing lands.",
            ),
            StackChoice(
                capability="Stem separation",
                selected_component="AudioShake primary, Music.AI secondary",
                runtime="worker",
                stage="next",
                reason="Fastest way to reach pro-quality stems without training our own models.",
                fallback_component="Demucs-compatible self-host fallback",
            ),
            StackChoice(
                capability="Lyrics and timestamps",
                selected_component="WhisperX",
                runtime="worker",
                stage="next",
                reason="Great speed and word-level alignment for lyric-aware editing.",
                fallback_component="AudioShake lyric alignment",
            ),
            StackChoice(
                capability="Audio to MIDI",
                selected_component="Spotify Basic Pitch",
                runtime="browser",
                stage="next",
                reason="Lightweight browser-friendly MIDI extraction with pitch bend support.",
            ),
            StackChoice(
                capability="Key, chords, and BPM",
                selected_component="Local spectral analysis now, Music.AI later",
                runtime="worker",
                stage="now",
                reason=(
                    "Real audio-derived tempo, key, chords, and arrangement notes now run "
                    "inside the prep workflow while the commercial provider path stays open."
                ),
                fallback_component="Music.AI for deeper hosted analysis later",
            ),
            StackChoice(
                capability="Cleanup and loudness",
                selected_component=settings.cleanup_provider,
                runtime="worker",
                stage="now",
                reason=(
                    "Cleanup and loudness polish now run through a hosted provider "
                    "instead of a custom chain."
                ),
                fallback_component="DeepFilterNet and VoiceFixer later",
            ),
            StackChoice(
                capability="Stretch and pitch",
                selected_component="Rubber Band via backend render queue",
                runtime="worker",
                stage="next",
                reason="Mature DSP for independent tempo and pitch transforms.",
                fallback_component="SoundTouch for lighter preview paths",
            ),
            StackChoice(
                capability="Generative fill and extend",
                selected_component=settings.generation_provider,
                runtime="worker",
                stage="now",
                reason=(
                    "ACE-Step via fal.ai matches the full-song generation lane in the "
                    "dual-engine architecture."
                ),
                fallback_component="Replicate MusicGen or Hugging Face endpoints",
            ),
            StackChoice(
                capability="Workflow orchestration",
                selected_component="Local threaded job runner now, Temporal next",
                runtime="infra",
                stage="now",
                reason="Ship quickly first, then harden multi-step provider orchestration.",
            ),
            StackChoice(
                capability="Storage and audit",
                selected_component="SQLite and local media now, Postgres and S3 later",
                runtime="infra",
                stage="now",
                reason="Keeps the MVP usable today without blocking on production infrastructure.",
            ),
            StackChoice(
                capability="Provenance and rights",
                selected_component=settings.provenance_backend,
                runtime="api",
                stage="next",
                reason="Exports need a standard-backed provenance path and visible rights gating.",
            ),
        ],
        implementation_phases=[
            ImplementationPhase(
                phase="Phase 1",
                goal="Usable web MVP",
                deliverables=[
                    "Project dashboard and studio workspace",
                    "Audio upload and local persistence",
                    "Seeded demo project and provider-aware prep jobs",
                    "Waveform playback, stem lanes, and analysis panels",
                    "Auphonic-backed polish pass for cleaned preview output",
                ],
            ),
            ImplementationPhase(
                phase="Phase 2",
                goal="Real provider wiring",
                deliverables=[
                    "AudioShake and Music.AI provider adapters",
                    "WhisperX lyric alignment pipeline",
                    "Basic Pitch MIDI extraction",
                    "Rubber Band render actions and cleanup jobs",
                ],
            ),
            ImplementationPhase(
                phase="Phase 3",
                goal="Production deploy polish",
                deliverables=[
                    "Auth and entitlements",
                    "Yjs collaboration",
                    "Temporal workflows",
                    "Backend C2PA export signing and audit trail",
                ],
            ),
        ],
    )


def build_architecture_plan(settings: Settings) -> ArchitecturePlanResponse:
    """Return the dual-engine studio architecture reflected in the current product."""

    return ArchitecturePlanResponse(
        title="Dual-engine AI music studio architecture",
        lanes=[
            ArchitectureLane(
                lane="Input Layer",
                summary="Unify prompt, upload, and MIDI-oriented sources into one session model.",
                components=[
                    ArchitectureComponent(
                        name="Audio and reference upload",
                        status="live",
                        runtime="browser",
                        description=(
                            "Users can create upload and reference-led projects from "
                            "the web dashboard."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Text prompt intake",
                        status="live",
                        runtime="browser",
                        description=(
                            "Prompt-led projects are accepted now and route into the "
                            "generation lane."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Live Web MIDI input",
                        status="live",
                        runtime="browser",
                        description=(
                            "Browser MIDI input now feeds live performance capture, "
                            "director reactions, and quick MIDI export in the workspace."
                        ),
                    ),
                    ArchitectureComponent(
                        name=".mid drop and parser",
                        status="planned",
                        runtime="browser",
                        description=(
                            "Planned @tonejs/midi import path for normalized MIDI features."
                        ),
                    ),
                ],
            ),
            ArchitectureLane(
                lane="Generation Engine",
                summary=(
                    "Prompt enhancement and full-song generation run beside the "
                    "editor, not inside it."
                ),
                components=[
                    ArchitectureComponent(
                        name="Prompt enhancer",
                        status="planned",
                        runtime="api",
                        description=(
                            "Will map casual prompts into structure-aware ACE tags "
                            "and lyric scaffolds."
                        ),
                    ),
                    ArchitectureComponent(
                        name=f"ACE-Step generation via {settings.generation_provider}",
                        status="demo",
                        runtime="worker",
                        description=(
                            "Generation lane is scaffolded now and will become real "
                            "once FAL credentials are added."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Built-in stem separation",
                        status="planned",
                        runtime="worker",
                        description=(
                            "Generated audio will immediately feed the stem prep path for editing."
                        ),
                    ),
                ],
            ),
            ArchitectureLane(
                lane="Bridge and Analysis",
                summary=(
                    "Audio or MIDI outputs are converted into constraints the "
                    "editing engine can consume."
                ),
                components=[
                    ArchitectureComponent(
                        name="Feature extractor",
                        status="live",
                        runtime="worker",
                        description=(
                            "Prep now computes real BPM, key, chord, and arrangement "
                            "summaries from source audio."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Performance analyzer",
                        status="live",
                        runtime="api",
                        description=(
                            "Conductr-style live performance analysis now normalizes incoming "
                            "MIDI inside the workspace."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Reference context builder",
                        status="planned",
                        runtime="api",
                        description=(
                            "Will package extracted structure into constraints for "
                            "the director layer."
                        ),
                    ),
                ],
            ),
            ArchitectureLane(
                lane="Editing Engine",
                summary=(
                    "The editor remains deterministic and web-first even as "
                    "generation gets more capable."
                ),
                components=[
                    ArchitectureComponent(
                        name="Session producer / musical director",
                        status="demo",
                        runtime="worker",
                        description=(
                            "A fallback browser-side director now reacts to live playing while "
                            "the model-backed director remains a later step."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Section lock manager",
                        status="planned",
                        runtime="browser",
                        description=(
                            "Track and region locks will gate regeneration inside the canvas."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Param interpolator",
                        status="live",
                        runtime="browser",
                        description=(
                            "Conductr-style smoothing now transitions live director parameters "
                            "over musical steps."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Procedural C/WASM engine",
                        status="planned",
                        runtime="browser",
                        description=(
                            "Reserved slot for the low-latency deterministic engine "
                            "from your target design."
                        ),
                    ),
                ],
            ),
            ArchitectureLane(
                lane="Critic Loop",
                summary=(
                    "Generated audio and edited patterns both flow through the "
                    "same evaluation loop."
                ),
                components=[
                    ArchitectureComponent(
                        name="AI music critic",
                        status="planned",
                        runtime="worker",
                        description=(
                            "Will score fidelity, production, emotion, and technical quality."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Refinement orchestrator",
                        status="planned",
                        runtime="worker",
                        description=(
                            "Will manage bounded rewrite loops before surfacing approved results."
                        ),
                    ),
                ],
            ),
            ArchitectureLane(
                lane="Output and UI",
                summary=(
                    "Web playback, export, and the studio canvas are already the "
                    "anchor surface of the product."
                ),
                components=[
                    ArchitectureComponent(
                        name="Web playback and waveform canvas",
                        status="live",
                        runtime="browser",
                        description=(
                            "Current workspace already renders waveform playback "
                            "and multistem lanes."
                        ),
                    ),
                    ArchitectureComponent(
                        name="Studio dashboard and live job polling",
                        status="live",
                        runtime="browser",
                        description=(
                            "Projects, jobs, and prep state are visible in real "
                            "time from the web app."
                        ),
                    ),
                    ArchitectureComponent(
                        name="MIDI export and DAW bridge",
                        status="live",
                        runtime="browser",
                        description=(
                            "The workspace can now echo notes to a selected MIDI output and "
                            "export captured performance as .mid."
                        ),
                    ),
                ],
            ),
        ],
    )


def build_deployment_readiness(settings: Settings) -> DeploymentReadinessResponse:
    """Return the current readiness status for live web deployment."""

    requirements = [
        AccessRequirement(
            name="Web host account",
            category="platform",
            required_for="cloud",
            status="configured" if settings.public_web_url.startswith("https://") else "manual",
            description=(
                "The web app is already published on Vercel when a public HTTPS URL is configured."
                if settings.public_web_url.startswith("https://")
                else "Need Vercel access to publish the Next.js web app."
            ),
        ),
        AccessRequirement(
            name="API host account",
            category="platform",
            required_for="cloud",
            status="configured" if settings.public_api_url.startswith("https://") else "manual",
            description=(
                "The API is already published on Vercel when a public HTTPS URL is configured."
                if settings.public_api_url.startswith("https://")
                else "Need Vercel or another API host to publish the FastAPI service."
            ),
        ),
        AccessRequirement(
            name="Public domain and DNS",
            category="domain",
            required_for="cloud",
            status="configured" if settings.public_web_url.startswith("https://") else "manual",
            description=(
                "Public vercel.app URLs are already usable; a custom domain is optional."
                if settings.public_web_url.startswith("https://")
                else "Optional custom domain access for branded public URLs."
            ),
        ),
        _env_requirement(
            name="fal.ai generation key",
            category="provider",
            required_for="generation",
            description="Required to activate ACE-Step generation from text or reference prompts.",
            value=settings.fal_key,
            env_var="CODEX_MUSIC_FAL_KEY",
        ),
        _env_requirement(
            name="AudioShake API key",
            category="provider",
            required_for="audio",
            description="Required for primary stem separation when moving past demo orchestration.",
            value=settings.audio_provider_api_key,
            env_var="CODEX_MUSIC_AUDIO_PROVIDER_API_KEY",
        ),
        _env_requirement(
            name="Music.AI API key",
            category="provider",
            required_for="audio",
            description="Required for secondary analysis and multi-capability audio services.",
            value=settings.music_ai_api_key,
            env_var="CODEX_MUSIC_MUSIC_AI_API_KEY",
        ),
        _env_requirement(
            name="Auphonic API key",
            category="provider",
            required_for="audio",
            description="Required for hosted cleanup, leveling, and loudness finishing workflows.",
            value=settings.cleanup_provider_api_key,
            env_var="CODEX_MUSIC_CLEANUP_PROVIDER_API_KEY",
        ),
        _env_requirement(
            name="Stripe secret key",
            category="billing",
            required_for="billing",
            description="Required for paid usage, entitlements, and metered billing.",
            value=settings.stripe_secret_key,
            env_var="CODEX_MUSIC_STRIPE_SECRET_KEY",
        ),
        _env_requirement(
            name="Cloud storage bucket",
            category="storage",
            required_for="cloud",
            description="Required when moving media and exports from local storage to S3 or R2.",
            value=settings.storage_bucket,
            env_var="CODEX_MUSIC_STORAGE_BUCKET",
        ),
        AccessRequirement(
            name="Auth provider setup",
            category="security",
            required_for="auth",
            status="manual",
            description=(
                "Need Auth0, Clerk, or another OIDC setup before multi-user production access."
            ),
        ),
    ]
    missing_items = [item.name for item in requirements if item.status == "missing"]
    local_ready = True
    cloud_ready = not any(
        item.status in {"missing", "manual"}
        and item.required_for in {"cloud", "generation", "audio", "billing", "auth"}
        for item in requirements
    )

    return DeploymentReadinessResponse(
        local_ready=local_ready,
        cloud_ready=cloud_ready,
        recommended_web_host="Vercel",
        recommended_api_host="Vercel",
        missing_items=missing_items,
        access_requirements=requirements,
    )


def _env_requirement(
    *,
    name: str,
    category: str,
    required_for: str,
    description: str,
    value: str,
    env_var: str,
) -> AccessRequirement:
    """Build one environment-backed readiness item."""

    return AccessRequirement(
        name=name,
        category=category,  # type: ignore[arg-type]
        required_for=required_for,  # type: ignore[arg-type]
        status="configured" if value else "missing",
        description=description,
        env_var=env_var,
    )
