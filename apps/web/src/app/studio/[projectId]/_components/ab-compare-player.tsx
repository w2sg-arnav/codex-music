"use client";

import { useMemo, useState } from "react";

import type { ProjectDetail } from "@/lib/api";
import { StatusPill } from "@/components/status-pill";
import { WaveformPlayer } from "./waveform-player";

type CompareVersion = {
  id: string;
  label: string;
  description: string;
  audioPath: string | null;
};

export function ABComparePlayer({ project }: { project: ProjectDetail }) {
  const versions = useMemo<CompareVersion[]>(() => {
    const candidates: CompareVersion[] = [
      {
        id: "source",
        label: "A · Source",
        description: "Original source feeding the studio pipeline.",
        audioPath: project.audio_path,
      },
      {
        id: "polished",
        label: "B · Polished",
        description: "Cleanup and loudness pass from the finishing lane.",
        audioPath: project.polished_audio_path,
      },
    ];
    return candidates.filter((candidate) => Boolean(candidate.audioPath));
  }, [project.audio_path, project.polished_audio_path]);
  const [activeVersionId, setActiveVersionId] = useState<string>(versions[0]?.id ?? "source");

  const activeVersion =
    versions.find((version) => version.id === activeVersionId) ?? versions[0] ?? null;

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">A/B Compare</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Switch between versions without leaving the editor
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            Keep the same listening position in mind while you compare the original source against
            the latest polished pass.
          </p>
        </div>
        <StatusPill label={`${versions.length} versions`} tone="neutral" />
      </div>

      {versions.length >= 2 && activeVersion ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => {
                  setActiveVersionId(version.id);
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  version.id === activeVersion.id
                    ? "bg-stone-950 text-stone-50"
                    : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
                }`}
              >
                {version.label}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm text-stone-500">{activeVersion.label}</p>
            <p className="mt-2 text-sm leading-7 text-stone-700">{activeVersion.description}</p>
          </div>

          <div className="mt-5">
            <WaveformPlayer
              audioPath={activeVersion.audioPath}
              title={activeVersion.label}
              readyLabel={`Previewing ${activeVersion.label.toLowerCase()}`}
              emptyLabel="No compare asset is available yet."
              description={activeVersion.description}
              allowSpectrogram
            />
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-[1.25rem] border border-dashed border-stone-300 bg-white px-5 py-10 text-sm text-stone-600">
          Create a polished preview to unlock fast A/B auditioning here.
        </div>
      )}
    </article>
  );
}
