import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProjectPerformancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/studio/${projectId}?view=performance`);
}
