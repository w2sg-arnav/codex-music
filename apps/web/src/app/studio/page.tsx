import { StatusPill } from "@/components/status-pill";
import { TopNav } from "@/components/top-nav";
import {
  getArchitecturePlan,
  getCapabilityCatalog,
  getDeploymentReadiness,
  getProjects,
} from "@/lib/api";
import { CreateProjectForm } from "./_components/create-project-form";
import { ProjectList } from "./_components/project-list";

export const dynamic = "force-dynamic";

const STUDIO_SURFACES = [
  "Project creation from upload, prompt, or reference",
  "Project browser with cached recovery",
  "Implementation plan visibility",
  "Architecture map visibility",
  "Deployment readiness surface",
] as const;

export default async function StudioPage() {
  const [projects, catalog, architecture, deployment] = await Promise.all([
    getProjects(),
    getCapabilityCatalog(),
    getArchitecturePlan(),
    getDeploymentReadiness(),
  ]);

  return (
    <>
      <TopNav />
      <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-6 pb-12 sm:px-10 lg:px-16">
        <section className="hero-panel rounded-[2rem] px-6 py-10 sm:px-10 lg:px-14">
          <div className="relative z-10 grid gap-10 lg:grid-cols-[1fr_0.95fr]">
            <div className="space-y-7">
              <div className="flex flex-wrap gap-3">
                <span className="eyebrow">Studio Control Room</span>
                <StatusPill label={`${projects.length} active sessions`} tone="neutral" />
                <StatusPill
                  label={deployment?.cloud_ready ? "cloud ready" : "cloud partial"}
                  tone={deployment?.cloud_ready ? "online" : "neutral"}
                />
              </div>

              <div className="space-y-5">
                <h1 className="text-5xl leading-[0.94] font-semibold tracking-[-0.06em] text-stone-950 sm:text-6xl">
                  Create, inspect, and route every music session from one web-native dashboard.
                </h1>
                <p className="max-w-3xl text-lg leading-8 text-stone-700">
                  This is the main operating surface for Codex Music: create new projects,
                  open live workspaces, inspect the finalized stack, and understand what is
                  already deployed versus what still needs hardening.
                </p>
              </div>

              <div className="surface-grid">
                {STUDIO_SURFACES.map((surface, index) => (
                  <div key={surface} className="hero-stat rounded-[1.25rem] p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-stone-500">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-stone-700">{surface}</p>
                  </div>
                ))}
              </div>
            </div>

            <CreateProjectForm />
          </div>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="glass-card rounded-[1.75rem] p-6">
            <ProjectList initialProjects={projects} />
          </article>

          <article className="glass-card rounded-[1.75rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Implementation Plan</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                  Finalized build path
                </h2>
              </div>
              <StatusPill label={`${catalog?.implementation_phases.length ?? 0} phases`} tone="neutral" />
            </div>

            <div className="mt-6 space-y-4">
              {(catalog?.implementation_phases ?? []).map((phase) => (
                <div
                  key={phase.phase}
                  className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium text-stone-900">{phase.phase}</p>
                    <StatusPill label={phase.goal} tone="neutral" />
                  </div>
                  <div className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                    {phase.deliverables.map((deliverable) => (
                      <p key={deliverable}>{deliverable}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="glass-card rounded-[1.75rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Architecture</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                  Dual-engine layout from input to export
                </h2>
              </div>
              <StatusPill label={`${architecture?.lanes.length ?? 0} lanes`} tone="neutral" />
            </div>

            <div className="mt-6 space-y-4">
              {(architecture?.lanes ?? []).map((lane) => (
                <div
                  key={lane.lane}
                  className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-stone-900">{lane.lane}</p>
                      <p className="mt-1 text-sm text-stone-600">{lane.summary}</p>
                    </div>
                    <StatusPill label={`${lane.components.length} blocks`} tone="neutral" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {lane.components.map((component) => (
                      <div
                        key={component.name}
                        className="rounded-[1rem] border border-stone-200 bg-white/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-sm font-medium text-stone-900">{component.name}</p>
                          <StatusPill label={component.status} tone="neutral" />
                        </div>
                        <p className="mt-2 text-sm leading-7 text-stone-700">
                          {component.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[1.75rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Deployment Readiness</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                  What still matters for production confidence
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  label={deployment?.local_ready ? "local ready" : "local blocked"}
                  tone={deployment?.local_ready ? "online" : "offline"}
                />
                <StatusPill
                  label={deployment?.cloud_ready ? "cloud ready" : "cloud partial"}
                  tone={deployment?.cloud_ready ? "online" : "neutral"}
                />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {(deployment?.access_requirements ?? []).map((item) => (
                <div
                  key={item.name}
                  className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-stone-900">{item.name}</p>
                      <p className="mt-1 text-sm text-stone-600">{item.description}</p>
                    </div>
                    <StatusPill
                      label={item.status}
                      tone={
                        item.status === "configured"
                          ? "online"
                          : item.status === "missing"
                            ? "offline"
                            : "neutral"
                      }
                    />
                  </div>
                  {item.env_var ? (
                    <p className="mt-3 font-mono text-xs text-stone-500">{item.env_var}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
