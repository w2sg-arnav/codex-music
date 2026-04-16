import { TopNav } from "@/components/top-nav";
import { getProjects } from "@/lib/api";
import { CreateProjectForm } from "./_components/create-project-form";
import { ProjectList } from "./_components/project-list";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const projects = await getProjects();

  return (
    <>
      <TopNav />
      <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-6 pb-12 sm:px-10 lg:px-16">
        <section className="hero-panel rounded-[2rem] px-6 py-10 sm:px-10 lg:px-14">
          <div className="relative z-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-7">
              <span className="eyebrow">Studio</span>

              <div className="space-y-5">
                <h1 className="text-5xl leading-[0.94] font-semibold tracking-[-0.06em] text-stone-950 sm:text-6xl">
                  Generate audio, edit stems, and reopen sessions from one studio.
                </h1>
                <p className="max-w-3xl text-lg leading-8 text-stone-700">
                  Start from a prompt, a reference track, or an upload. Prompt and reference
                  sessions generate audio automatically, then open in the edit workspace where you
                  can play the track, inspect stems, and keep working.
                </p>
              </div>

              <div className="section-grid">
                <div className="hero-stat rounded-[1.25rem] p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-stone-500">
                    Generate
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-700">
                    Prompt and reference sessions create audio and drop it straight into the
                    workspace player.
                  </p>
                </div>
                <div className="hero-stat rounded-[1.25rem] p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-stone-500">
                    Edit
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-700">
                    Use waveforms, stems, MIDI sketching, and the timeline editor without leaving
                    the same route.
                  </p>
                </div>
                <div className="hero-stat rounded-[1.25rem] p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-stone-500">
                    Reopen
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-700">
                    Jump back into recent sessions and keep listening, polishing, or exporting.
                  </p>
                </div>
              </div>
            </div>

            <CreateProjectForm />
          </div>
        </section>

        <section className="mt-8">
          <article className="glass-card rounded-[1.75rem] p-6">
            <ProjectList initialProjects={projects} />
          </article>
        </section>
      </main>
    </>
  );
}
