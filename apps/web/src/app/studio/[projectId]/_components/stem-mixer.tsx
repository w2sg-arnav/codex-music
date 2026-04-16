"use client";

import { useMemo, useState } from "react";

import type { ProjectDetail } from "@/lib/api";
import { StatusPill } from "@/components/status-pill";
import { WaveformPlayer } from "./waveform-player";

function formatContentType(value: string | null): string {
  if (!value) {
    return "unknown format";
  }
  return value.replace("audio/", "").toUpperCase();
}

export function StemMixer({ project }: { project: ProjectDetail }) {
  const [mutedStemIds, setMutedStemIds] = useState<string[]>([]);
  const [soloStemId, setSoloStemId] = useState<string | null>(null);

  const laneStatus = useMemo(() => {
    return new Map(
      project.stems.map((stem) => [
        stem.id,
        {
          muted: mutedStemIds.includes(stem.id),
          focused: soloStemId === null || soloStemId === stem.id,
        },
      ]),
    );
  }, [mutedStemIds, project.stems, soloStemId]);

  const uniqueStemSources = new Set(
    project.stems.map((stem) => stem.audio_path).filter((value): value is string => Boolean(value)),
  );
  const isFallbackPreview = uniqueStemSources.size <= 1;

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Stem Mixer</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Audition isolated lanes
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            Each stem gets its own playback lane so you can focus the arrangement before timeline
            edits and export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label={`${project.stems.length} stems`} tone="neutral" />
          <StatusPill
            label={soloStemId ? "solo active" : "full mix"}
            tone={soloStemId ? "online" : "neutral"}
          />
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {isFallbackPreview && project.audio_path ? (
          <WaveformPlayer
            audioPath={project.audio_path}
            title="Current Mix Preview"
            readyLabel="Use this player while isolated stem renders catch up"
            emptyLabel="No mix preview is ready yet."
            description="You can still listen to the current track here, then jump back into the timeline while isolated lanes finish preparing."
            compact
          />
        ) : null}

        {project.stems.length > 0 ? (
          project.stems.map((stem) => {
            const status = laneStatus.get(stem.id) ?? { muted: false, focused: true };
            const isMuted = status.muted;
            const isSoloed = soloStemId === stem.id;
            const isHiddenBySolo = soloStemId !== null && !status.focused;

            return (
              <div
                key={stem.id}
                className={`rounded-[1.25rem] border p-4 transition ${
                  isMuted || isHiddenBySolo
                    ? "border-stone-200 bg-stone-100/80 opacity-70"
                    : "border-stone-200 bg-stone-50"
                }`}
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-stone-950">{stem.name}</p>
                      <StatusPill label={stem.kind} tone="neutral" />
                      <StatusPill label={formatContentType(stem.audio_content_type)} tone="neutral" />
                    </div>
                    <p className="mt-2 text-sm text-stone-600">
                      {stem.provider} · stem level {stem.level_db >= 0 ? "+" : ""}
                      {stem.level_db.toFixed(1)} dB
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMutedStemIds((current) =>
                          current.includes(stem.id)
                            ? current.filter((id) => id !== stem.id)
                            : [...current, stem.id],
                        );
                      }}
                      className="rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                    >
                      {isMuted ? "Unmute lane" : "Mute lane"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSoloStemId((current) => (current === stem.id ? null : stem.id));
                      }}
                      className="rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                    >
                      {isSoloed ? "Exit solo" : "Solo lane"}
                    </button>
                  </div>
                </div>

                {isHiddenBySolo ? (
                  <div className="rounded-[1rem] border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                    Solo mode is focused on another lane right now.
                  </div>
                ) : isMuted ? (
                  <div className="rounded-[1rem] border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                    This lane is muted. Unmute it to resume playback and waveform inspection.
                  </div>
                ) : isFallbackPreview ? (
                  <div className="rounded-[1rem] border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                    Isolated audio is still rendering for this lane. Use the current mix preview
                    above while this stem catches up.
                  </div>
                ) : (
                  <WaveformPlayer
                    audioPath={stem.audio_path}
                    title={`${stem.name} Playback`}
                    readyLabel={`Previewing the ${stem.name.toLowerCase()} lane`}
                    emptyLabel="This stem does not have a playable asset yet."
                    description="Use the waveform or spectrogram view to inspect the isolated lane before trimming or export."
                    allowSpectrogram
                    compact
                  />
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-stone-300 bg-white px-5 py-10 text-sm text-stone-600">
            Run studio prep to generate stems, then the mixer will show playable lanes here.
          </div>
        )}
      </div>
    </article>
  );
}
