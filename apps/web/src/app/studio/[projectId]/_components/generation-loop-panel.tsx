"use client";

import { StatusPill } from "@/components/status-pill";
import { type ProjectDetail, resolveApiUrl } from "@/lib/api";

function toneForLoopStatus(status: string) {
  if (status === "passed") {
    return "online" as const;
  }
  if (status === "needs-review") {
    return "offline" as const;
  }
  return "neutral" as const;
}

function toneForScore(score: number | null) {
  if (score === null) {
    return "neutral" as const;
  }
  if (score >= 8.0) {
    return "online" as const;
  }
  if (score >= 7.2) {
    return "neutral" as const;
  }
  return "offline" as const;
}

export function GenerationLoopPanel({ project }: { project: ProjectDetail }) {
  const loop = project.analysis.refinement_loop;

  if (project.source_type === "upload") {
    return (
      <article className="glass-card rounded-[1.5rem] p-6">
        <p className="eyebrow">Generation Loop</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
          Prompt refinement and critic loop
        </h2>
        <div className="mt-5 rounded-[1.1rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-sm leading-7 text-stone-600">
          This project is running the upload-first path. Prompt enhancement, version scoring, and
          auto-refinement appear here for prompt-led and reference-led generation sessions.
        </div>
      </article>
    );
  }

  if (!loop) {
    return (
      <article className="glass-card rounded-[1.5rem] p-6">
        <p className="eyebrow">Generation Loop</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
          Prompt refinement and critic loop
        </h2>
        <div className="mt-5 rounded-[1.1rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-sm leading-7 text-stone-600">
          Run studio prep to structure the prompt, generate candidate versions, score them, and
          surface the selected version before it lands in the editor.
        </div>
      </article>
    );
  }

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Generation Loop</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Prompt enhancer, critic, and auto-refinement
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            The prompt is structured, scored, and iterated before the chosen version is handed to
            the editor. All surfaced versions stay visible here before you move into waveform,
            stems, and lockable clip edits.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label={loop.status} tone={toneForLoopStatus(loop.status)} />
          <StatusPill label={`${loop.threshold.toFixed(1)} threshold`} tone="neutral" />
          <StatusPill label={`${loop.versions.length}/${loop.max_iterations} versions`} tone="neutral" />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
          <p className="text-sm text-stone-500">Prompt model</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{loop.prompt_model}</p>
          <p className="mt-4 text-sm text-stone-500">Critic model</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{loop.critic_model}</p>
        </div>

        <div className="rounded-[1.1rem] border border-stone-300 bg-stone-100 p-4">
          <p className="text-sm text-stone-500">Strict generation guidelines</p>
          <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
            {loop.strict_guidelines.map((guideline) => (
              <li key={guideline}>{guideline}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {loop.versions.map((version) => {
          const audioUrl = resolveApiUrl(version.audio_path);
          const averageScore = version.critic?.average ?? null;

          return (
            <div
              key={version.id}
              className="rounded-[1.2rem] border border-stone-300 bg-stone-100 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-stone-950">
                      Version {version.iteration}
                    </p>
                    {version.selected_for_editing ? (
                      <StatusPill label="selected for editor" tone="online" />
                    ) : null}
                    <StatusPill
                      label={
                        averageScore === null ? "pending critic" : `${averageScore.toFixed(1)} avg`
                      }
                      tone={toneForScore(averageScore)}
                    />
                  </div>
                  <p className="mt-2 text-sm leading-7 text-stone-700">{version.prompt_text}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill label={version.provider} tone="neutral" />
                  <StatusPill
                    label={version.passed_threshold ? "passed threshold" : "refined"}
                    tone={version.passed_threshold ? "online" : "neutral"}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[1rem] border border-stone-300 bg-white p-4">
                  <p className="text-sm text-stone-500">Enhanced prompt</p>
                  <p className="mt-3 text-sm leading-7 text-stone-700">
                    {version.enhanced_prompt}
                  </p>
                  {version.rewrite_brief ? (
                    <>
                      <p className="mt-4 text-sm text-stone-500">Rewrite brief</p>
                      <p className="mt-2 text-sm leading-7 text-stone-700">
                        {version.rewrite_brief}
                      </p>
                    </>
                  ) : null}
                </div>

                <div className="rounded-[1rem] border border-stone-300 bg-white p-4">
                  <p className="text-sm text-stone-500">Critic suggestions</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
                    {version.improvement_suggestions.length > 0 ? (
                      version.improvement_suggestions.map((suggestion) => (
                        <li key={suggestion}>{suggestion}</li>
                      ))
                    ) : (
                      <li>No extra rewrite was needed for this version.</li>
                    )}
                  </ul>
                </div>
              </div>

              {audioUrl ? (
                <audio controls src={audioUrl} className="mt-4 w-full" />
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}
