export type HealthResponse = {
  status: "ok";
  environment: string;
  version: string;
};

export type StackChoice = {
  capability: string;
  selected_component: string;
  runtime: "browser" | "api" | "worker" | "infra";
  stage: "now" | "next";
  reason: string;
  fallback_component: string | null;
};

export type ImplementationPhase = {
  phase: string;
  goal: string;
  deliverables: string[];
};

export type CapabilityCatalog = {
  application: string;
  target_surface: string;
  deployment_targets: string[];
  core_objects: string[];
  must_build: string[];
  provider_capabilities: StackChoice[];
  implementation_phases: ImplementationPhase[];
};

export type ArchitectureComponent = {
  name: string;
  status: "live" | "demo" | "planned" | "external";
  runtime: "browser" | "api" | "worker" | "infra";
  description: string;
};

export type ArchitectureLane = {
  lane: string;
  summary: string;
  components: ArchitectureComponent[];
};

export type ArchitecturePlan = {
  title: string;
  lanes: ArchitectureLane[];
};

export type AccessRequirement = {
  name: string;
  category: "provider" | "platform" | "storage" | "billing" | "domain" | "security";
  required_for: "local" | "cloud" | "generation" | "audio" | "billing" | "auth";
  status: "configured" | "missing" | "manual";
  description: string;
  env_var: string | null;
};

export type DeploymentReadiness = {
  local_ready: boolean;
  cloud_ready: boolean;
  recommended_web_host: string;
  recommended_api_host: string;
  missing_items: string[];
  access_requirements: AccessRequirement[];
};

export type AnalysisSummary = {
  bpm: number | null;
  musical_key: string | null;
  chord_progression: string[];
  lyric_excerpt: string | null;
  midi_ready: boolean;
  arrangement_notes: string[];
  engine_mode: "upload-first" | "ace-generate-edit";
  enhanced_prompt: string | null;
  reference_constraints: string[];
  bridge_notes: string[];
  sections: ArrangementSection[];
  critic: CriticScores | null;
  refinement_loop: RefinementLoopSummary | null;
  provider: string;
};

export type ArrangementSection = {
  label: string;
  start_bar: number;
  end_bar: number;
  energy: "low" | "medium" | "high";
  summary: string;
};

export type CriticScores = {
  fidelity: number;
  quality: number;
  emotion: number;
  production: number;
  technical: number;
  average: number;
  verdict: string;
  notes: string[];
};

export type GenerationVersion = {
  id: string;
  iteration: number;
  prompt_text: string;
  enhanced_prompt: string;
  audio_path: string | null;
  provider: string;
  critic: CriticScores | null;
  passed_threshold: boolean;
  rewrite_brief: string | null;
  improvement_suggestions: string[];
  selected_for_editing: boolean;
};

export type RefinementLoopSummary = {
  status: "idle" | "running" | "passed" | "needs-review";
  prompt_model: string;
  critic_model: string;
  threshold: number;
  max_iterations: number;
  strict_guidelines: string[];
  selected_version_id: string | null;
  versions: GenerationVersion[];
};

export type RightsSummary = {
  clearance: string;
  provenance_status: string;
  export_readiness: string;
  notes: string[];
};

export type StemView = {
  id: string;
  name: string;
  kind: string;
  color: string;
  level_db: number;
  audio_path: string | null;
  audio_content_type: string | null;
  provider: string;
};

export type JobView = {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  provider: string;
  message: string;
  updated_at: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  source_type: "upload" | "prompt" | "reference";
  status: "draft" | "processing" | "ready" | "attention";
  created_at: string;
  updated_at: string;
  primary_provider: string;
  audio_filename: string | null;
  audio_path: string | null;
  source_notes: string | null;
  stem_count: number;
  next_action: string;
};

export type ProjectDetail = ProjectSummary & {
  audio_content_type: string | null;
  audio_size_bytes: number | null;
  polished_audio_filename: string | null;
  polished_audio_path: string | null;
  polished_audio_content_type: string | null;
  polished_audio_provider: string | null;
  analysis: AnalysisSummary;
  rights: RightsSummary;
  stems: StemView[];
  jobs: JobView[];
  next_actions: string[];
};

export type ProjectImportResponse = {
  project: ProjectDetail;
};

export type StudioPrepResponse = {
  project: ProjectDetail;
};

export type StudioSnapshot = {
  api: HealthResponse | null;
  capabilities: CapabilityCatalog | null;
  architecture: ArchitecturePlan | null;
  deployment: DeploymentReadiness | null;
  projects: ProjectSummary[];
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getStudioSnapshot(): Promise<StudioSnapshot> {
  try {
    const [api, capabilities, architecture, deployment, projects] = await Promise.all([
      fetchJson<HealthResponse>("/healthz"),
      fetchJson<CapabilityCatalog>("/api/v1/capabilities"),
      fetchJson<ArchitecturePlan>("/api/v1/capabilities/architecture"),
      fetchJson<DeploymentReadiness>("/api/v1/capabilities/deployment-readiness"),
      fetchJson<ProjectSummary[]>("/api/v1/projects"),
    ]);

    return { api, capabilities, architecture, deployment, projects };
  } catch {
    return {
      api: null,
      capabilities: null,
      architecture: null,
      deployment: null,
      projects: [],
    };
  }
}

export async function getCapabilityCatalog(): Promise<CapabilityCatalog | null> {
  try {
    return await fetchJson<CapabilityCatalog>("/api/v1/capabilities");
  } catch {
    return null;
  }
}

export async function getProjects(): Promise<ProjectSummary[]> {
  try {
    return await fetchJson<ProjectSummary[]>("/api/v1/projects");
  } catch {
    return [];
  }
}

export async function getArchitecturePlan(): Promise<ArchitecturePlan | null> {
  try {
    return await fetchJson<ArchitecturePlan>("/api/v1/capabilities/architecture");
  } catch {
    return null;
  }
}

export async function getDeploymentReadiness(): Promise<DeploymentReadiness | null> {
  try {
    return await fetchJson<DeploymentReadiness>(
      "/api/v1/capabilities/deployment-readiness",
    );
  } catch {
    return null;
  }
}

export async function getProject(projectId: string): Promise<ProjectDetail | null> {
  try {
    return await fetchJson<ProjectDetail>(`/api/v1/projects/${projectId}`);
  } catch {
    return null;
  }
}

export async function createProjectImport(
  formData: FormData,
): Promise<ProjectImportResponse> {
  return fetchJson<ProjectImportResponse>("/api/v1/projects/import", {
    method: "POST",
    body: formData,
  });
}

export async function runStudioPrep(
  projectId: string,
): Promise<StudioPrepResponse> {
  return fetchJson<StudioPrepResponse>(`/api/v1/projects/${projectId}/studio-prep`, {
    method: "POST",
  });
}

export async function runCleanupPass(
  projectId: string,
): Promise<StudioPrepResponse> {
  return fetchJson<StudioPrepResponse>(`/api/v1/projects/${projectId}/cleanup`, {
    method: "POST",
  });
}

export function resolveApiUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

export function getProjectExportBundleUrl(projectId: string): string {
  return `${API_BASE_URL}/api/v1/projects/${projectId}/export-bundle`;
}

export function getProjectEventsUrl(projectId: string): string {
  return `${API_BASE_URL}/api/v1/projects/${projectId}/events`;
}
