"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";

import {
  type ProjectDetail,
  type StackChoice,
  getProject,
  getProjectExportBundleUrl,
  runCleanupPass,
  runStudioPrep,
} from "@/lib/api";
import { StatusPill } from "@/components/status-pill";
import { cacheProject } from "@/lib/project-cache";
import { ABComparePlayer } from "./ab-compare-player";
import { MidiLab } from "./midi-lab";
import { StemMixer } from "./stem-mixer";
import { TimelineEditor } from "./timeline-editor";
import { WaveformPlayer } from "./waveform-player";
import { PerformanceMode } from "../performance/_components/performance-mode";

type WorkspaceView = "overview" | "edit" | "performance";

const VIEW_OPTIONS: Array<{
  id: WorkspaceView;
  label: string;
  summary: string;
}> = [
  {
    id: "overview",
    label: "Overview",
    summary: "Everything present, analysis, jobs, and rights in one control-room view.",
  },
  {
    id: "edit",
    label: "Edit Deck",
    summary: "Waveforms, stems, MIDI sketching, and the non-destructive timeline.",
  },
  {
    id: "performance",
    label: "Performance Deck",
    summary: "Conductr live generation, direction prompts, MIDI routing, and pads.",
  },
] as const;

function hasActiveJobs(project: ProjectDetail) {
  return project.jobs.some((job) => job.status === "queued" || job.status === "running");
}

function normalizeView(value: string | null): WorkspaceView {
  if (value === "performance" || value === "edit" || value === "overview") {
    return value;
  }
  return "overview";
}

function statusTone(status: ProjectDetail["status"]) {
  if (status === "ready") {
    return "online" as const;
  }
  if (status === "attention") {
    return "offline" as const;
  }
  return "neutral" as const;
}

function criticTone(average: number | null | undefined) {
  if (!average) {
    return "neutral" as const;
  }
  if (average >= 8.2) {
    return "online" as const;
  }
  if (average >= 7.5) {
    return "neutral" as const;
  }
  return "offline" as const;
}

function workspaceSurfaces(project: ProjectDetail) {
  const surfaces = [
    "Upload, prompt, and reference intake",
    "Integrated source review and spectrogram playback",
    "Analysis, sections, and provider orchestration",
    "Rights readiness and export bundle",
    "Integrated Conductr performance deck",
  ];

  if (project.polished_audio_path) {
    surfaces.push("Polished preview and A/B compare");
  }
  if (project.stems.length > 0) {
    surfaces.push("Stem mixer with lane playback");
    surfaces.push("Non-destructive multitrack timeline");
  }
  if (project.analysis.midi_ready) {
    surfaces.push("Browser MIDI sketch extraction");
  }

  return surfaces;
}

function PlaceholderCard({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
        {title}
      </h2>
      <div className="mt-5 rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-sm leading-7 text-stone-600">
        {description}
      </div>
    </article>
  );
}

export function StudioWorkspace({
  initialProject,
  stackChoices,
}: {
  initialProject: ProjectDetail;
  stackChoices: StackChoice[];
}) {
  const [project, setProject] = useState(initialProject);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const exportBundleUrl = getProjectExportBundleUrl(project.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeView = normalizeView(searchParams.get("view"));

  const surfaceInventory = useMemo(() => workspaceSurfaces(project), [project]);
  const liveStack = useMemo(
    () => stackChoices.filter((choice) => choice.stage === "now").slice(0, 8),
    [stackChoices],
  );
  const activeJobs = useMemo(
    () =>
      project.jobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [project.jobs],
  );

  const refreshProject = useEffectEvent(async () => {
    const latest = await getProject(project.id);
    if (!latest) {
      return;
    }
    cacheProject(latest);
    startTransition(() => {
      setProject(latest);
    });
  });

  useEffect(() => {
    cacheProject(project);
  }, [project]);

  useEffect(() => {
    if (!hasActiveJobs(project)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshProject();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [project]);

  function setView(nextView: WorkspaceView) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === "overview") {
      params.delete("view");
    } else {
      params.set("view", nextView);
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }

  async function handleRunPrep() {
    setError(null);
    try {
      const response = await runStudioPrep(project.id);
      cacheProject(response.project);
      startTransition(() => {
        setProject(response.project);
      });
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not start studio prep.",
      );
    }
  }

  async function handleRunCleanup() {
    setError(null);
    try {
      const response = await runCleanupPass(project.id);
      cacheProject(response.project);
      startTransition(() => {
        setProject(response.project);
      });
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not start the cleanup pass.",
      );
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-6 pb-10 sm:px-10 lg:px-16">
      <section className="hero-panel rounded-[2rem] px-6 py-6 sm:px-8 lg:px-10">
        <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_430px]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">Unified Studio Workspace</span>
              <StatusPill label={project.status} tone={statusTone(project.status)} />
              <StatusPill label={project.primary_provider} tone="neutral" />
              <StatusPill
                label={project.analysis.engine_mode === "ace-generate-edit" ? "generation bridge" : "upload-first"}
                tone="neutral"
              />
            </div>

            <div className="space-y-4">
              <h1 className="max-w-5xl text-4xl font-semibold tracking-[-0.06em] text-stone-950 sm:text-5xl xl:text-6xl">
                Edit, generate, and perform from one landscape control room.
              </h1>
              <p className="max-w-4xl text-base leading-7 text-stone-700 sm:text-lg">
                {project.analysis.engine_mode === "ace-generate-edit"
                  ? "Prompt or reference context feeds the generation bridge first, then the result lands in the same workspace for stems, playback, timeline editing, MIDI extraction, and live performance control."
                  : "Imported audio now stays in the same workspace from prep through editing, MIDI sketching, and live performance control, instead of splitting the product into separate surfaces."}
              </p>
              {project.source_notes ? (
                <div className="rounded-[1.25rem] border border-stone-300 bg-stone-100 px-4 py-4 text-sm leading-7 text-stone-700">
                  {project.source_notes}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {surfaceInventory.map((surface) => (
                <span
                  key={surface}
                  className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-medium tracking-[0.12em] text-stone-700 uppercase"
                >
                  {surface}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <article className="hero-stat rounded-[1.5rem] p-5">
              <p className="eyebrow">Workspace Snapshot</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-3">
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Stems</p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                    {project.stems.length}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Jobs live</p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                    {activeJobs}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Now wired</p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                    {liveStack.length}
                  </p>
                </div>
              </div>
            </article>

            <article className="inventory-card rounded-[1.5rem] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Everything Present</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    One route, three decks
                  </h2>
                </div>
                <StatusPill label={`${VIEW_OPTIONS.length} panels`} tone="neutral" />
              </div>
              <div className="mt-4 space-y-3">
                {VIEW_OPTIONS.map((option) => (
                  <div
                    key={option.id}
                    className="rounded-[1.1rem] border border-stone-300 bg-stone-100 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium text-stone-900">{option.label}</p>
                      {activeView === option.id ? (
                        <StatusPill label="active" tone="online" />
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-7 text-stone-700">{option.summary}</p>
                  </div>
                ))}
              </div>
            </article>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/studio"
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
              >
                Back to sessions
              </Link>
              <a
                href={exportBundleUrl}
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
              >
                Download export bundle
              </a>
              <button
                type="button"
                onClick={() => {
                  void handleRunCleanup();
                }}
                disabled={isPending || hasActiveJobs(project) || !project.audio_path}
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400"
              >
                {project.jobs.some(
                  (job) =>
                    job.kind === "cleanup" &&
                    (job.status === "queued" || job.status === "running"),
                )
                  ? "Polish pass running..."
                  : "Run polish pass"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRunPrep();
                }}
                disabled={isPending || hasActiveJobs(project)}
                className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {hasActiveJobs(project)
                  ? "Studio prep running..."
                  : isPending
                    ? "Refreshing..."
                    : "Run studio prep"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
            {error}
          </p>
        ) : null}
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setView(option.id);
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeView === option.id
                  ? "bg-stone-950 text-stone-50"
                  : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusPill label={project.analysis.provider} tone="neutral" />
          <StatusPill
            label={project.analysis.midi_ready ? "midi ready" : "midi pending"}
            tone={project.analysis.midi_ready ? "online" : "neutral"}
          />
          {project.analysis.critic ? (
            <StatusPill
              label={`${project.analysis.critic.average.toFixed(1)} critic`}
              tone={criticTone(project.analysis.critic.average)}
            />
          ) : null}
        </div>
      </section>

      {activeView === "overview" ? (
        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.1fr)_340px]">
          <div className="space-y-6">
            <article className="glass-card rounded-[1.5rem] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow">Present Right Now</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    Live surfaces in this workspace
                  </h2>
                </div>
                <StatusPill label={`${surfaceInventory.length} surfaces`} tone="neutral" />
              </div>
              <div className="mt-5 grid gap-3">
                {surfaceInventory.map((surface) => (
                  <div
                    key={surface}
                    className="rounded-[1.1rem] border border-stone-300 bg-stone-100 px-4 py-3 text-sm leading-7 text-stone-700"
                  >
                    {surface}
                  </div>
                ))}
              </div>
            </article>

            <article className="glass-card rounded-[1.5rem] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow">Finalized Stack</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    Existing components we are leaning on
                  </h2>
                </div>
                <StatusPill label={`${liveStack.length} now`} tone="neutral" />
              </div>
              <div className="mt-5 space-y-3">
                {liveStack.map((choice) => (
                  <div
                    key={choice.capability}
                    className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium text-stone-900">{choice.capability}</p>
                      <StatusPill label={choice.runtime} tone="neutral" />
                    </div>
                    <p className="mt-2 text-sm leading-7 text-stone-700">
                      {choice.selected_component}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="space-y-6">
            <article className="glass-card rounded-[1.5rem] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow">Music Intelligence</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    Analysis layer
                  </h2>
                </div>
                <StatusPill label={project.analysis.engine_mode} tone="neutral" />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">BPM</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-950">
                    {project.analysis.bpm ?? "—"}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Key</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-950">
                    {project.analysis.musical_key ?? "—"}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">MIDI</p>
                  <p className="mt-2 text-lg font-semibold text-stone-950">
                    {project.analysis.midi_ready ? "Ready" : "Pending"}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Critic</p>
                  <p className="mt-2 text-lg font-semibold text-stone-950">
                    {project.analysis.critic
                      ? project.analysis.critic.average.toFixed(1)
                      : "Pending"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Chord progression</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {project.analysis.chord_progression.length > 0 ? (
                      project.analysis.chord_progression.map((chord) => (
                        <span
                          key={chord}
                          className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm text-emerald-900"
                        >
                          {chord}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-stone-600">Pending analysis.</span>
                    )}
                  </div>
                  <p className="mt-4 text-sm leading-7 text-stone-700">
                    {project.analysis.lyric_excerpt ?? "Run studio prep to align lyrics."}
                  </p>
                </div>

                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Arrangement notes</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                    {project.analysis.arrangement_notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {project.analysis.sections.length > 0 ? (
                <div className="mt-4 rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-stone-500">Section map</p>
                    <StatusPill label={`${project.analysis.sections.length} sections`} tone="neutral" />
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {project.analysis.sections.map((section) => (
                      <div
                        key={`${section.label}-${section.start_bar}-${section.end_bar}`}
                        className="rounded-[1rem] border border-stone-300 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-stone-900">{section.label}</p>
                            <StatusPill label={section.energy} tone="neutral" />
                          </div>
                          <p className="text-sm text-stone-500">
                            Bars {section.start_bar}-{section.end_bar}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-stone-700">
                          {section.summary}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Reference constraints</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                    {project.analysis.reference_constraints.length > 0 ? (
                      project.analysis.reference_constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))
                    ) : (
                      <li>No reference constraints extracted yet.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Bridge notes</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                    {project.analysis.bridge_notes.length > 0 ? (
                      project.analysis.bridge_notes.map((note) => <li key={note}>{note}</li>)
                    ) : (
                      <li>Bridge extraction has not run yet.</li>
                    )}
                  </ul>
                </div>
              </div>

              {project.analysis.enhanced_prompt ? (
                <div className="mt-4 rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Enhanced prompt</p>
                  <p className="mt-3 text-sm leading-7 text-stone-700">
                    {project.analysis.enhanced_prompt}
                  </p>
                </div>
              ) : null}

              {project.analysis.critic ? (
                <div className="mt-4 rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="text-sm text-stone-500">AI critic</p>
                    <StatusPill
                      label={`${project.analysis.critic.average.toFixed(1)} avg`}
                      tone={criticTone(project.analysis.critic.average)}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-5">
                    {[
                      ["Fidelity", project.analysis.critic.fidelity],
                      ["Quality", project.analysis.critic.quality],
                      ["Emotion", project.analysis.critic.emotion],
                      ["Production", project.analysis.critic.production],
                      ["Technical", project.analysis.critic.technical],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-[1rem] border border-stone-300 bg-white p-4"
                      >
                        <p className="text-sm text-stone-500">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-stone-950">
                          {Number(value).toFixed(1)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-[1rem] border border-stone-300 bg-white p-4">
                    <p className="text-sm text-stone-500">Verdict</p>
                    <p className="mt-2 text-sm font-medium text-stone-900">
                      {project.analysis.critic.verdict}
                    </p>
                    <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                      {project.analysis.critic.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </article>

            <article className="glass-card rounded-[1.5rem] p-6">
              <p className="eyebrow">Jobs</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                Provider orchestration
              </h2>
              <div className="mt-5 grid gap-3">
                {project.jobs.length > 0 ? (
                  project.jobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-start justify-between gap-4 rounded-[1.1rem] border border-stone-300 bg-stone-100 px-4 py-4"
                    >
                      <div>
                        <p className="font-medium text-stone-900">{job.kind}</p>
                        <p className="mt-1 text-sm text-stone-600">{job.message}</p>
                        <p className="mt-2 font-mono text-xs text-stone-500">{job.provider}</p>
                      </div>
                      <StatusPill
                        label={job.status}
                        tone={
                          job.status === "completed"
                            ? "online"
                            : job.status === "failed"
                              ? "offline"
                              : "neutral"
                        }
                      />
                    </div>
                  ))
                ) : (
                  <div className="rounded-[1.1rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-sm text-stone-600">
                    Studio jobs will appear here as soon as prep starts.
                  </div>
                )}
              </div>
            </article>
          </div>

          <div className="space-y-6">
            <article className="glass-card rounded-[1.5rem] p-6">
              <p className="eyebrow">Rights and Export</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                Commercial readiness
              </h2>
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Clearance</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    {project.rights.clearance}
                  </p>
                </div>
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Provenance</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    {project.rights.provenance_status}
                  </p>
                </div>
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Export readiness</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    {project.rights.export_readiness}
                  </p>
                </div>
                <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
                  <p className="text-sm text-stone-500">Polished output</p>
                  <p className="mt-2 text-sm leading-7 text-stone-700">
                    {project.polished_audio_path
                      ? `${project.polished_audio_filename ?? "Preview file"} via ${project.polished_audio_provider ?? "cleanup provider"}`
                      : "No polished preview yet. Run the polish pass to generate one."}
                  </p>
                </div>
                <a
                  href={exportBundleUrl}
                  className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Export WAV + stems + analysis bundle
                </a>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-7 text-stone-700">
                {project.rights.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </article>

            <article className="glass-card rounded-[1.5rem] p-6">
              <p className="eyebrow">Next Actions</p>
              <div className="mt-4 space-y-3">
                {project.next_actions.map((action) => (
                  <div
                    key={action}
                    className="rounded-[1.1rem] border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-800"
                  >
                    {action}
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeView === "edit" ? (
        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
          <div className="space-y-6">
            <div className="grid gap-6 2xl:grid-cols-2">
              <WaveformPlayer
                audioPath={project.audio_path}
                title="Source Audio"
                readyLabel="Previewing the current project source"
                emptyLabel="No source audio is available yet. Run studio prep first."
                description="This is the source feeding stems, analysis, cleanup, and export."
                allowSpectrogram
              />

              {project.polished_audio_path ? (
                <WaveformPlayer
                  audioPath={project.polished_audio_path}
                  title="Polished Preview"
                  readyLabel="Previewing the cleanup and loudness pass"
                  emptyLabel="Run the polish pass to create a cleaned preview."
                  description="This is the polished review pass before export or A/B comparison."
                  allowSpectrogram
                />
              ) : (
                <PlaceholderCard
                  eyebrow="Polished Preview"
                  title="No finish pass yet"
                  description="Run the polish pass from the workspace header to generate a cleaned preview and unlock faster A/B review."
                />
              )}
            </div>

            <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <ABComparePlayer project={project} />
              <MidiLab project={project} />
            </div>

            {project.stems.length > 0 ? (
              <TimelineEditor
                key={`${project.id}:${project.stems.length}:${project.audio_path ?? "none"}`}
                project={project}
              />
            ) : (
              <PlaceholderCard
                eyebrow="Timeline Editor"
                title="Multitrack regions are waiting on prep"
                description="Run studio prep to populate stems, then the non-destructive clip editor will appear here."
              />
            )}
          </div>

          <div className="space-y-6">
            <StemMixer project={project} />
          </div>
        </section>
      ) : null}

      {activeView === "performance" ? (
        <section className="mt-6">
          <PerformanceMode project={project} embedded />
        </section>
      ) : null}
    </main>
  );
}
