"use client";

import type { ConductrEvent, ConductrTrackId } from "@/lib/conductr/model";

const TRACK_LABELS: Record<ConductrTrackId, string> = {
  bass: "Bass",
  drums: "Drums",
  harmony: "Harmony",
  melody: "Melody",
};

const TRACK_COLORS: Record<ConductrTrackId, string> = {
  bass: "bg-sky-500",
  drums: "bg-rose-500",
  harmony: "bg-violet-500",
  melody: "bg-emerald-500",
};

function opacityClass(velocity: number): string {
  if (velocity >= 110) {
    return "opacity-100";
  }
  if (velocity >= 90) {
    return "opacity-85";
  }
  if (velocity >= 70) {
    return "opacity-70";
  }
  if (velocity >= 45) {
    return "opacity-50";
  }
  return "opacity-25";
}

export function PatternGrid({
  patterns,
  step,
}: {
  patterns: Record<ConductrTrackId, ConductrEvent[]>;
  step: number;
}) {
  const trackIds = ["drums", "bass", "melody", "harmony"] as const;

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Pattern Grid</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Conductr-style 4x16 arrangement view
          </h2>
        </div>
        <p className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700">
          Step {step + 1}
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="min-w-[920px] space-y-3">
          <div className="grid grid-cols-[180px_repeat(16,minmax(0,1fr))] gap-2 px-2 text-[11px] uppercase tracking-[0.16em] text-stone-500">
            <span>Track</span>
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index} className="text-center">
                {index + 1}
              </span>
            ))}
          </div>

          {trackIds.map((trackId) => (
            <div
              key={trackId}
              className="grid grid-cols-[180px_repeat(16,minmax(0,1fr))] gap-2"
            >
              <div className="rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3">
                <p className="font-medium text-stone-900">{TRACK_LABELS[trackId]}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {patterns[trackId].filter((event) => event.velocity > 0).length} active steps
                </p>
              </div>

              {patterns[trackId].map((event, index) => {
                const isActive = event.velocity > 0;
                const isPlayhead = index === step;
                return (
                  <div
                    key={`${trackId}-${index}`}
                    className={`relative flex min-h-16 items-end justify-center overflow-hidden rounded-[1rem] border px-1 py-2 transition ${
                      isPlayhead
                        ? "border-stone-950 bg-stone-950/6"
                        : "border-stone-200 bg-stone-50"
                    }`}
                  >
                    {isActive ? (
                      <div
                        className={`w-full rounded-[0.85rem] ${TRACK_COLORS[trackId]} ${opacityClass(event.velocity)}`}
                        style={{
                          height: `${Math.max(18, Math.round((event.velocity / 127) * 46))}px`,
                        }}
                        title={`Note ${event.note} · Velocity ${event.velocity}`}
                      />
                    ) : (
                      <div className="h-2 w-full rounded-full bg-stone-200" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
