from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check payload for the API service."""

    status: Literal["ok"]
    environment: str
    version: str


class ProviderCapability(BaseModel):
    """A reuse-first provider decision for one capability."""

    capability: str
    strategy: Literal["buy-first", "hybrid", "build"]
    providers: list[str] = Field(default_factory=list)
    note: str


class CapabilityCatalogResponse(BaseModel):
    """Top-level catalog of platform capabilities."""

    application: str
    target_surface: str
    deployment_targets: list[str]
    core_objects: list[str]
    must_build: list[str]
    provider_capabilities: list[StackChoice]
    implementation_phases: list[ImplementationPhase]


class ArchitectureComponent(BaseModel):
    """One component inside the broader dual-engine studio architecture."""

    name: str
    status: Literal["live", "demo", "planned", "external"]
    runtime: Literal["browser", "api", "worker", "infra"]
    description: str


class ArchitectureLane(BaseModel):
    """One lane of the end-to-end studio architecture."""

    lane: str
    summary: str
    components: list[ArchitectureComponent]


class ArchitecturePlanResponse(BaseModel):
    """A product-level architecture view of the studio pipeline."""

    title: str
    lanes: list[ArchitectureLane]


class AccessRequirement(BaseModel):
    """One platform or credential dependency required for local or cloud use."""

    name: str
    category: Literal["provider", "platform", "storage", "billing", "domain", "security"]
    required_for: Literal["local", "cloud", "generation", "audio", "billing", "auth"]
    status: Literal["configured", "missing", "manual"]
    description: str
    env_var: str | None = None


class DeploymentReadinessResponse(BaseModel):
    """Deployment readiness and credential status for the web product."""

    local_ready: bool
    cloud_ready: bool
    recommended_web_host: str
    recommended_api_host: str
    missing_items: list[str]
    access_requirements: list[AccessRequirement]


class StackChoice(BaseModel):
    """A finalized component decision for one capability area."""

    capability: str
    selected_component: str
    runtime: Literal["browser", "api", "worker", "infra"]
    stage: Literal["now", "next"]
    reason: str
    fallback_component: str | None = None


class ImplementationPhase(BaseModel):
    """A phased implementation slice for the product roadmap."""

    phase: str
    goal: str
    deliverables: list[str]


class ArrangementSection(BaseModel):
    """A coarse musical section extracted from the current source."""

    label: str
    start_bar: int
    end_bar: int
    energy: Literal["low", "medium", "high"]
    summary: str


class CriticScores(BaseModel):
    """Five-dimensional scoring for generation and edit review."""

    fidelity: float
    quality: float
    emotion: float
    production: float
    technical: float
    average: float
    verdict: str
    notes: list[str] = Field(default_factory=list)


class GenerationVersion(BaseModel):
    """One generated draft surfaced to the user during prompt refinement."""

    id: str
    iteration: int
    prompt_text: str
    enhanced_prompt: str
    audio_path: str | None = None
    provider: str
    critic: CriticScores | None = None
    passed_threshold: bool = False
    rewrite_brief: str | None = None
    improvement_suggestions: list[str] = Field(default_factory=list)
    selected_for_editing: bool = False


class RefinementLoopSummary(BaseModel):
    """Closed-loop generation state from prompt enhancement through critic review."""

    status: Literal["idle", "running", "passed", "needs-review"] = "idle"
    prompt_model: str = "heuristic-director"
    critic_model: str = "music-critic-agent"
    threshold: float = 7.8
    max_iterations: int = 3
    strict_guidelines: list[str] = Field(default_factory=list)
    selected_version_id: str | None = None
    versions: list[GenerationVersion] = Field(default_factory=list)


class AnalysisSummary(BaseModel):
    """Structured music analysis returned for a project."""

    bpm: float | None = None
    musical_key: str | None = None
    chord_progression: list[str] = Field(default_factory=list)
    lyric_excerpt: str | None = None
    midi_ready: bool = False
    arrangement_notes: list[str] = Field(default_factory=list)
    engine_mode: Literal["upload-first", "ace-generate-edit"] = "upload-first"
    enhanced_prompt: str | None = None
    reference_constraints: list[str] = Field(default_factory=list)
    bridge_notes: list[str] = Field(default_factory=list)
    sections: list[ArrangementSection] = Field(default_factory=list)
    critic: CriticScores | None = None
    refinement_loop: RefinementLoopSummary | None = None
    provider: str = "demo"


class RightsSummary(BaseModel):
    """Rights and provenance state for project exports."""

    clearance: str
    provenance_status: str
    export_readiness: str
    notes: list[str] = Field(default_factory=list)


class StemView(BaseModel):
    """One visible stem lane in the studio workspace."""

    id: str
    name: str
    kind: str
    color: str
    level_db: float
    audio_path: str | None = None
    audio_content_type: str | None = None
    provider: str


class JobView(BaseModel):
    """A long-running studio job attached to a project."""

    id: str
    kind: str
    status: Literal["queued", "running", "completed", "failed"]
    provider: str
    message: str
    updated_at: str


class ProjectSummary(BaseModel):
    """Summary card data for the studio dashboard."""

    id: str
    name: str
    source_type: Literal["upload", "prompt", "reference"]
    status: Literal["draft", "processing", "ready", "attention"]
    created_at: str
    updated_at: str
    primary_provider: str
    audio_filename: str | None = None
    audio_path: str | None = None
    source_notes: str | None = None
    stem_count: int = 0
    next_action: str


class ProjectDetail(ProjectSummary):
    """Full project state for the studio workspace."""

    audio_content_type: str | None = None
    audio_size_bytes: int | None = None
    polished_audio_filename: str | None = None
    polished_audio_path: str | None = None
    polished_audio_content_type: str | None = None
    polished_audio_provider: str | None = None
    analysis: AnalysisSummary
    rights: RightsSummary
    stems: list[StemView] = Field(default_factory=list)
    jobs: list[JobView] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)


class ProjectImportResponse(BaseModel):
    """Response returned when a new project is created from the dashboard."""

    project: ProjectDetail


class StudioPrepResponse(BaseModel):
    """Response returned when studio prep starts or re-runs."""

    project: ProjectDetail
