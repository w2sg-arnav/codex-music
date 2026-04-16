"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  type ProjectDetail,
  type StackChoice,
  getProject,
} from "@/lib/api";
import { cacheProject, getCachedProject } from "@/lib/project-cache";
import { StudioWorkspace } from "./studio-workspace";

export function ProjectStudioShell({
  projectId,
  initialProject,
  stackChoices,
}: {
  projectId: string;
  initialProject: ProjectDetail | null;
  stackChoices: StackChoice[];
}) {
  const [project, setProject] = useState<ProjectDetail | null>(
    () => initialProject ?? getCachedProject(projectId),
  );

  useEffect(() => {
    if (initialProject) {
      cacheProject(initialProject);
      return;
    }

    void getProject(projectId).then((latest) => {
      if (!latest) {
        return;
      }
      cacheProject(latest);
      setProject(latest);
    });
  }, [initialProject, projectId]);

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-6 pb-10 sm:px-10 lg:px-16">
        <div className="glass-card rounded-[2rem] px-6 py-8 sm:px-10">
          <p className="eyebrow">Studio Workspace</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
            Loading or recovering this session...
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
            If the API has rotated to a fresh serverless instance, the browser cache will
            repopulate this workspace after you open a generated session once.
          </p>
          <Link
            href="/studio"
            className="mt-6 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Back to studio
          </Link>
        </div>
      </main>
    );
  }

  return <StudioWorkspace initialProject={project} stackChoices={stackChoices} />;
}
