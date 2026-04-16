import { TopNav } from "@/components/top-nav";
import { getProject } from "@/lib/api";
import { ProjectStudioShell } from "./_components/project-studio-shell";

export const dynamic = "force-dynamic";

export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  return (
    <>
      <TopNav />
      <ProjectStudioShell projectId={projectId} initialProject={project} />
    </>
  );
}
