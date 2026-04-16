import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { TopNav } from "@/components/top-nav";
import { getStudioSnapshot } from "@/lib/api";

export const dynamic = "force-dynamic";

const PRODUCT_SURFACES = [
  "Prompt, upload, and reference-based project intake",
  "Provider-backed studio prep with generation, stems, lyrics, analysis, and cleanup jobs",
  "Source audio playback with waveform and spectrogram review",
  "A/B compare between source and polished output",
  "Stem mixer with lane-level monitoring",
  "Non-destructive multitrack timeline editing with clip commands",
  "Browser MIDI extraction and sketch export",
  "Integrated performance deck with Web MIDI routing and performance analysis",
  "Conductr-inspired procedural pattern generation inside the same workspace",
  "Rights, provenance, and export readiness panels",
  "ZIP export bundle generation",
  "Public deployed web surface on Vercel",
] as const;

const SYSTEM_METRICS = [
  { label: "Product surfaces", value: `${PRODUCT_SURFACES.length}` },
  { label: "Projects visible", value: "live" },
  { label: "Engine lanes", value: "dual" },
] as const;

export default async function Home() {
  const snapshot = await getStudioSnapshot();
  const capabilities = snapshot.capabilities;

  return (
    <>
      <TopNav />
      <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-6 pb-12 sm:px-10 lg:px-16">
        <section className="hero-panel rounded-[2rem] px-6 py-10 sm:px-10 lg:px-14">
          <div className="relative z-10 grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-8">
              <div className="flex flex-wrap gap-3">
                <span className="eyebrow">Open Studio System</span>
                <StatusPill
                  label={snapshot.api ? "api online" : "api offline"}
                  tone={snapshot.api ? "online" : "offline"}
                />
                <StatusPill label="vercel deployed" tone="neutral" />
              </div>

              <div className="space-y-5">
                <h1 className="max-w-5xl text-5xl font-semibold tracking-[-0.06em] text-stone-950 sm:text-6xl lg:text-7xl">
                  The AI-native music studio that actually feels like a product.
                </h1>
                <p className="max-w-3xl text-lg leading-8 text-stone-700 sm:text-xl">
                  Codex Music now combines generation, analysis, editing, MIDI, and
                  Conductr-style performance in one live web surface. The goal of this
                  redesign is simple: make the platform read like a polished company and
                  a usable studio at the same time.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/studio"
                  className="rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Open studio
                </Link>
                <Link
                  href={snapshot.projects[0] ? `/studio/${snapshot.projects[0].id}` : "/studio"}
                  className="rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                >
                  Open demo workspace
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              <article className="hero-stat rounded-[1.5rem] p-6">
                <p className="eyebrow">What Is Live</p>
                <div className="mt-5 surface-grid">
                  {SYSTEM_METRICS.map((metric) => (
                    <div key={metric.label} className="rounded-[1.25rem] border border-stone-300 bg-stone-100 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                        {metric.label}
                      </p>
                      <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                        {metric.label === "Projects visible" ? snapshot.projects.length : metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="inventory-card rounded-[1.5rem] p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="eyebrow">System Snapshot</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                      Current deployment state
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-stone-500">
                    {snapshot.api?.version ?? "not connected"}
                  </span>
                </div>

                <div className="mt-5 space-y-4 text-sm leading-7 text-stone-700">
                  <div>
                    <p className="font-medium text-stone-900">Target surface</p>
                    <p>
                      {capabilities?.target_surface ??
                        "Website scaffold is live and connected to the API where available."}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-stone-900">Deployment targets</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(capabilities?.deployment_targets ?? []).map((target) => (
                        <span
                          key={target}
                          className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700"
                        >
                          {target}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">Everything Present</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-stone-950">
                The deployed product surfaces you can use right now.
              </h2>
            </div>
            <StatusPill label={`${PRODUCT_SURFACES.length} live surfaces`} tone="neutral" />
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {PRODUCT_SURFACES.map((surface, index) => (
              <article key={surface} className="inventory-card rounded-[1.5rem] p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone-500">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-4 text-lg leading-8 text-stone-900">{surface}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="site-divider my-8" />

        <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <article className="glass-card rounded-[1.75rem] p-6">
            <p className="eyebrow mb-4">Provider Stack</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Reuse-first components, clearly exposed.
            </h2>
            <div className="mt-6 space-y-3">
              {(capabilities?.provider_capabilities ?? []).slice(0, 8).map((item) => (
                <div
                  key={item.capability}
                  className="rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-4"
                >
                  <p className="font-medium text-stone-900">{item.capability}</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    {item.selected_component}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[1.75rem] p-6">
            <p className="eyebrow mb-4">Open Sessions</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Start from the demo or jump straight into your latest workspace.
            </h2>
            <div className="mt-6 space-y-3">
              {snapshot.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/studio/${project.id}`}
                  className="block rounded-[1.25rem] border border-stone-200 bg-stone-50 px-5 py-5 transition hover:border-stone-400 hover:bg-stone-100/80"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-stone-950">{project.name}</p>
                      <p className="mt-2 text-sm leading-7 text-stone-600">
                        {project.next_action}
                      </p>
                    </div>
                    <StatusPill label={project.status} tone="neutral" />
                  </div>
                </Link>
              ))}
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
