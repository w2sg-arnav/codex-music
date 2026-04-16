"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type { ProjectSummary } from "@/lib/api";
import { listCachedProjectSummaries } from "@/lib/project-cache";

function mergeProjects(serverProjects: ProjectSummary[]) {
  const merged = new Map<string, ProjectSummary>();
  for (const project of listCachedProjectSummaries()) {
    merged.set(project.id, project);
  }
  for (const project of serverProjects) {
    merged.set(project.id, project);
  }

  return Array.from(merged.values()).sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );
}

export function ProjectList({ initialProjects }: { initialProjects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initialProjects);

  useEffect(() => {
    setProjects(mergeProjects(initialProjects));
  }, [initialProjects]);

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Projects</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Working sessions
          </h2>
        </div>
        <StatusPill label={`${projects.length} total`} tone="neutral" />
      </div>

      <div className="space-y-4">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/studio/${project.id}`}
            className="block rounded-[1.5rem] border border-stone-200 bg-stone-50 p-5 transition hover:border-stone-400 hover:bg-stone-100/80"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-stone-950">{project.name}</p>
                <p className="mt-1 text-sm text-stone-600">
                  {project.audio_filename ?? project.source_notes ?? "No audio uploaded yet"}
                </p>
              </div>
              <StatusPill label={project.status} tone="neutral" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-stone-300 bg-stone-200 px-3 py-1.5 text-sm text-stone-800">
                {project.primary_provider}
              </span>
              <span className="rounded-full border border-stone-300 bg-stone-200 px-3 py-1.5 text-sm text-stone-800">
                {project.stem_count} stems
              </span>
              <span className="rounded-full border border-stone-300 bg-stone-200 px-3 py-1.5 text-sm text-stone-800">
                {project.next_action}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
