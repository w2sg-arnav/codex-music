"use client";

import type { ConductrPulse } from "@/lib/conductr/model";

const TRACK_NAMES = ["Drums", "Bass", "Melody", "Harmony"];
const TRACK_GRADIENTS = [
  "from-rose-500 to-orange-400",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-lime-400",
  "from-violet-500 to-fuchsia-400",
];

export function PerformanceVisualizer({ pulses }: { pulses: ConductrPulse[] }) {
  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <p className="eyebrow">Event Bridge</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
        Pulse view for engine and player events
      </h2>
      <p className="mt-2 text-sm leading-7 text-stone-700">
        This keeps the Conductr event-to-visual boundary separate from the engine itself.
      </p>

      <div className="mt-5 space-y-3">
        {TRACK_NAMES.map((trackName, trackIndex) => {
          const trackPulses = pulses.filter((pulse) => pulse.trackIndex === trackIndex);

          return (
            <div
              key={trackName}
              className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="font-medium text-stone-900">{trackName}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-stone-500">
                  {trackPulses.length} active pulses
                </p>
              </div>
              <div className="relative flex min-h-20 items-end gap-2 overflow-hidden rounded-[1rem] bg-stone-950 px-3 py-3">
                {trackPulses.length > 0 ? (
                  trackPulses.map((pulse) => (
                    <div
                      key={pulse.id}
                      className={`w-3 rounded-full bg-gradient-to-t ${TRACK_GRADIENTS[trackIndex]}`}
                      style={{
                        height: `${Math.max(18, Math.round((pulse.velocity / 127) * 56))}px`,
                        opacity: pulse.kind === "player" ? 1 : 0.78,
                      }}
                      title={`${pulse.kind} pulse · velocity ${pulse.velocity}`}
                    />
                  ))
                ) : (
                  <div className="text-sm text-stone-400">Waiting for notes...</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
