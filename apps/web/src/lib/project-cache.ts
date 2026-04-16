"use client";

import type { ProjectDetail, ProjectSummary } from "@/lib/api";

const PROJECT_CACHE_KEY = "codex-music-project-cache-v1";

function readCache(): ProjectDetail[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(PROJECT_CACHE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ProjectDetail[];
  } catch {
    return [];
  }
}

function writeCache(projects: ProjectDetail[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify(projects));
}

export function cacheProject(project: ProjectDetail) {
  const nextProjects = [project, ...readCache().filter((entry) => entry.id !== project.id)]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, 12);
  writeCache(nextProjects);
}

export function getCachedProject(projectId: string): ProjectDetail | null {
  return readCache().find((project) => project.id === projectId) ?? null;
}

export function listCachedProjectSummaries(): ProjectSummary[] {
  return readCache().map((project) => ({
    id: project.id,
    name: project.name,
    source_type: project.source_type,
    status: project.status,
    created_at: project.created_at,
    updated_at: project.updated_at,
    primary_provider: project.primary_provider,
    audio_filename: project.audio_filename,
    audio_path: project.audio_path,
    source_notes: project.source_notes,
    stem_count: project.stem_count,
    next_action: project.next_action,
  }));
}
