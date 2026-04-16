"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { type ProjectDetail, getProject } from "@/lib/api";
import { cacheProject, getCachedProject } from "@/lib/project-cache";
import { StudioWorkspace } from "./studio-workspace";

export function ProjectStudioShell({
  projectId,
  initialProject,
}: {
  projectId: string;
  initialProject: ProjectDetail | null;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(
    () => initialProject ?? getCachedProject(projectId),
  );
  const [isRetrying, setIsRetrying] = useState(false);

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

  async function retryLoad() {
    setIsRetrying(true);
    try {
      const latest = await getProject(projectId);
      if (!latest) {
        return;
      }
      cacheProject(latest);
      setProject(latest);
    } finally {
      setIsRetrying(false);
    }
  }

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-6 pb-10 sm:px-10 lg:px-16">
        <div className="glass-card rounded-[2rem] px-6 py-8 sm:px-10">
          <p className="eyebrow">Session Recovery</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
            This session is not loaded yet.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
            Reload the session if the API was slow to wake up, or go back and open another saved
            session. Generated tracks and uploads should appear here once the project detail loads.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void retryLoad();
              }}
              className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
            >
              {isRetrying ? "Retrying..." : "Reload session"}
            </button>
            <Link
              href="/studio"
              className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
            >
              Back to studio
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <StudioWorkspace initialProject={project} />;
}
