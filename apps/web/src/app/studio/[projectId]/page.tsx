import { TopNav } from "@/components/top-nav";
import { getCapabilityCatalog, getProject } from "@/lib/api";
import { ProjectStudioShell } from "./_components/project-studio-shell";

export const dynamic = "force-dynamic";

export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, catalog] = await Promise.all([
    getProject(projectId),
    getCapabilityCatalog(),
  ]);

  return (
    <>
      <TopNav />
      <ProjectStudioShell
        projectId={projectId}
        initialProject={project}
        stackChoices={catalog?.provider_capabilities ?? []}
      />
    </>
  );
}
