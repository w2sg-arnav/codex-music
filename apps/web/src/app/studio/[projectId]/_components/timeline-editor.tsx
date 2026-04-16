"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { ProjectDetail } from "@/lib/api";
import {
  type EditorClip,
  type EditorSession,
  getInitialEditorSession,
  persistEditorSession,
  quantizeBeat,
  runEditorCommand,
} from "@/lib/editor-session";

const BEATS_PER_BAR = 4;
const BASE_PIXELS_PER_BEAT = 18;
const TRACK_LABEL_WIDTH = 208;
const MIN_CLIP_BEATS = 1;

type DragMode = "move" | "trim-start" | "trim-end";

type DragState = {
  clipId: string;
  mode: DragMode;
  startClientX: number;
  origin: EditorClip;
};

type SuggestedCommand = {
  label: string;
  command: string;
  reason: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatBeatLabel(value: number): string {
  return `${value.toFixed(1).replace(".0", "")} beats`;
}

function formatDb(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function clipLeft(clip: EditorClip, pixelsPerBeat: number): number {
  return clip.clipStartBeat * pixelsPerBeat;
}

function clipWidth(clip: EditorClip, pixelsPerBeat: number): number {
  return Math.max(clip.clipLengthBeats * pixelsPerBeat, 16);
}

function findSelectedClip(session: EditorSession): EditorClip | null {
  return session.clips.find((clip) => clip.id === session.selectedClipId) ?? null;
}

function formatCommandTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildSuggestedCommands(
  project: ProjectDetail,
  session: EditorSession,
  selectedClip: EditorClip | null,
): SuggestedCommand[] {
  const leadConstraint =
    project.analysis.reference_constraints[0] ??
    project.analysis.bridge_notes[0] ??
    project.analysis.arrangement_notes[0] ??
    null;

  if (!selectedClip) {
    return [
      {
        label: "Extend timeline",
        command: "extend timeline by 1 bar",
        reason: "Keeps one more arrangement bar open for downstream edits.",
      },
      {
        label: "Reset playhead",
        command: "reset playhead on timeline",
        reason: "Brings the audition point back to the start of the session.",
      },
      {
        label: "Clear solos",
        command: "clear solo tracks",
        reason: "Restores the full arrangement after focused listening.",
      },
    ];
  }

  const suggestions: SuggestedCommand[] = [];
  const canExtendSelectedClip =
    selectedClip.sourceLengthBeats >
    selectedClip.sourceStartBeat + selectedClip.clipLengthBeats;

  if (selectedClip.locked) {
    suggestions.push({
      label: "Unlock region",
      command: "unlock clip",
      reason: "This region is protected right now, so no arrangement edits can land yet.",
    });
  } else {
    suggestions.push({
      label: "Tighten fades",
      command: "tighten fades",
      reason:
        selectedClip.fadeInBeats < 1 || selectedClip.fadeOutBeats < 1
          ? "Adds short protective fades before you audition harder transitions."
          : "Keeps region edges smooth while you keep iterating.",
    });

    suggestions.push({
      label: "Duplicate region",
      command: "duplicate clip",
      reason:
        project.analysis.chord_progression.length > 0
          ? `Useful for alternate passes over ${project.analysis.chord_progression
              .slice(0, 2)
              .join(" -> ")}.`
          : "Creates a safe alternate pass without touching the original region.",
    });

    if (
      session.playheadBeat > selectedClip.clipStartBeat + 1 &&
      session.playheadBeat < selectedClip.clipStartBeat + selectedClip.clipLengthBeats - 1
    ) {
      suggestions.push({
        label: "Split here",
        command: "split at playhead",
        reason: "Cuts the region at the current playhead so AI edits can target one section.",
      });
    }

    suggestions.push(
      canExtendSelectedClip
        ? {
            label: "Extend 1 bar",
            command: "extend by 1 bar",
            reason: leadConstraint
              ? `Preserves runway for: ${leadConstraint}`
              : project.analysis.engine_mode === "ace-generate-edit"
                ? "Keeps room for the generated arrangement to breathe before the next edit."
                : "Creates more room for editing the selected region in context.",
          }
        : {
            label: "Trim end 1 beat",
            command: "trim end 1 beat",
            reason:
              "This region is already using the full source, so a small trim opens up room for later extension or splitting.",
          },
    );

    suggestions.push({
      label: "Focus track",
      command: "focus track",
      reason: "Soloes the current stem so you can audition the next change in isolation.",
    });

    suggestions.push({
      label: selectedClip.gainDb < 0 ? "Lift 2 dB" : "Trim 2 dB",
      command: selectedClip.gainDb < 0 ? "boost 2 dB" : "cut 2 dB",
      reason:
        selectedClip.gainDb < 0
          ? "Brings a recessed region closer to its track balance."
          : "Creates headroom before more aggressive edits.",
    });
  }

  if (!selectedClip.locked) {
    suggestions.push({
      label: "Lock arrangement",
      command: "lock clip",
      reason: "Protects this arrangement decision before you branch further.",
    });
  }

  return suggestions.slice(0, 4);
}

export function TimelineEditor({ project }: { project: ProjectDetail }) {
  const [session, setSession] = useState<EditorSession>(() => getInitialEditorSession(project));
  const [commandInput, setCommandInput] = useState("");
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [commandStatus, setCommandStatus] = useState<
    "applied" | "blocked" | "unmatched" | null
  >(null);
  const dragStateRef = useRef<DragState | null>(null);
  const pixelsPerBeat = BASE_PIXELS_PER_BEAT * session.zoom;
  const totalWidth = session.totalBeats * pixelsPerBeat;
  const selectedClip = findSelectedClip(session);
  const suggestedCommands = buildSuggestedCommands(project, session, selectedClip);

  useEffect(() => {
    persistEditorSession(session);
  }, [session]);

  const applyDrag = useEffectEvent((event: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag) {
      return;
    }

    const deltaBeats = quantizeBeat((event.clientX - drag.startClientX) / pixelsPerBeat);
    setSession((current) => {
      const updatedClips = current.clips.map((clip) => {
        if (clip.id !== drag.clipId || clip.locked) {
          return clip;
        }

        if (drag.mode === "move") {
          const nextStart = clamp(
            quantizeBeat(drag.origin.clipStartBeat + deltaBeats),
            0,
            current.totalBeats - drag.origin.clipLengthBeats,
          );
          return {
            ...clip,
            clipStartBeat: nextStart,
          };
        }

        if (drag.mode === "trim-start") {
          const minDelta = -drag.origin.sourceStartBeat;
          const maxDelta = drag.origin.clipLengthBeats - MIN_CLIP_BEATS;
          const nextDelta = clamp(deltaBeats, minDelta, maxDelta);
          return {
            ...clip,
            clipStartBeat: quantizeBeat(drag.origin.clipStartBeat + nextDelta),
            clipLengthBeats: quantizeBeat(drag.origin.clipLengthBeats - nextDelta),
            sourceStartBeat: quantizeBeat(drag.origin.sourceStartBeat + nextDelta),
          };
        }

        const maxExtension =
          drag.origin.sourceLengthBeats -
          (drag.origin.sourceStartBeat + drag.origin.clipLengthBeats);
        const minExtension = -(drag.origin.clipLengthBeats - MIN_CLIP_BEATS);
        const nextDelta = clamp(deltaBeats, minExtension, maxExtension);
        return {
          ...clip,
          clipLengthBeats: quantizeBeat(drag.origin.clipLengthBeats + nextDelta),
        };
      });

      return {
        ...current,
        clips: updatedClips,
      };
    });
  });

  const stopDragging = useEffectEvent(() => {
    dragStateRef.current = null;
  });

  useEffect(() => {
    window.addEventListener("pointermove", applyDrag);
    window.addEventListener("pointerup", stopDragging);

    return () => {
      window.removeEventListener("pointermove", applyDrag);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, []);

  function updateSelectedClip(updater: (clip: EditorClip) => EditorClip) {
    if (!selectedClip) {
      return;
    }

    setSession((current) => ({
      ...current,
      clips: current.clips.map((clip) => (clip.id === selectedClip.id ? updater(clip) : clip)),
    }));
  }

  function applyEditorCommand(command: string, source: "command-bar" | "quick-action") {
    let outcome:
      | ReturnType<typeof runEditorCommand>
      | undefined;

    setSession((current) => {
      outcome = runEditorCommand(current, command, source);
      return outcome.nextSession;
    });

    if (!outcome) {
      return;
    }

    setCommandStatus(outcome.status);
    setCommandFeedback(outcome.summary);

    if (source === "command-bar") {
      setCommandInput("");
    }
  }

  function handleDeleteSelectedClip() {
    applyEditorCommand("delete clip", "quick-action");
  }

  function handleToggleTrackMute(trackId: string) {
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) =>
        track.id === trackId ? { ...track, muted: !track.muted } : track,
      ),
    }));
  }

  function handleToggleTrackSolo(trackId: string) {
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) =>
        track.id === trackId ? { ...track, solo: !track.solo } : track,
      ),
    }));
  }

  function startDrag(
    event: React.PointerEvent<HTMLDivElement>,
    clip: EditorClip,
    mode: DragMode,
  ) {
    if (clip.locked) {
      return;
    }

    event.stopPropagation();
    dragStateRef.current = {
      clipId: clip.id,
      mode,
      startClientX: event.clientX,
      origin: clip,
    };
    setSession((current) => ({
      ...current,
      selectedClipId: clip.id,
    }));
  }

  const barCount = Math.ceil(session.totalBeats / BEATS_PER_BAR);

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Timeline Editor</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Non-destructive multitrack editing
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            This is the first real editor slice of the original product: clips can be
            moved, trimmed, split, duplicated, gain-staged, faded, muted, and locked
            without changing the source audio underneath.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setSession((current) => ({
                ...current,
                zoom: clamp(Number((current.zoom - 0.25).toFixed(2)), 0.75, 2.5),
              }));
            }}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
          >
            Zoom -
          </button>
          <button
            type="button"
            onClick={() => {
              setSession((current) => ({
                ...current,
                zoom: clamp(Number((current.zoom + 0.25).toFixed(2)), 0.75, 2.5),
              }));
            }}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
          >
            Zoom +
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-4">
          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
            <div className="rounded-[1.25rem] border border-stone-200 bg-white/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                    AI command layer
                  </p>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-stone-700">
                    The studio director can apply arrangement-safe edits directly to the
                    selected region. Type plain commands or use the contextual suggestions
                    built from this project&apos;s stems, bridge notes, and reference cues.
                  </p>
                </div>
                <div className="rounded-full bg-stone-950 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-stone-50">
                  {project.analysis.engine_mode}
                </div>
              </div>

              <form
                className="mt-4 flex flex-col gap-3 lg:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyEditorCommand(commandInput, "command-bar");
                }}
              >
                <input
                  type="text"
                  value={commandInput}
                  onChange={(event) => {
                    setCommandInput(event.target.value);
                  }}
                  placeholder='Try "extend by 1 bar", "boost 2 dB", or "focus track"'
                  className="min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-5 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                />
                <button
                  type="submit"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Apply command
                </button>
              </form>

              {commandFeedback ? (
                <p
                  className={`mt-4 rounded-2xl px-4 py-3 text-sm leading-7 ${
                    commandStatus === "blocked"
                      ? "bg-amber-100 text-amber-900"
                      : commandStatus === "applied"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-stone-100 text-stone-700"
                  }`}
                >
                  {commandFeedback}
                </p>
              ) : null}

              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                  Suggested next edits
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {suggestedCommands.map((suggestion) => (
                    <button
                      key={`${suggestion.label}:${suggestion.command}`}
                      type="button"
                      onClick={() => {
                        applyEditorCommand(suggestion.command, "quick-action");
                      }}
                      className="rounded-[1.25rem] border border-stone-200 bg-white/80 px-4 py-4 text-left transition hover:border-stone-900 hover:bg-stone-100"
                    >
                      <span className="block text-sm font-medium text-stone-950">
                        {suggestion.label}
                      </span>
                      <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-stone-500">
                        {suggestion.command}
                      </span>
                      <span className="mt-2 block text-sm leading-7 text-stone-700">
                        {suggestion.reason}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  applyEditorCommand("split at playhead", "quick-action");
                }}
                disabled={!selectedClip}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Split at playhead
              </button>
              <button
                type="button"
                onClick={() => {
                  applyEditorCommand("duplicate clip", "quick-action");
                }}
                disabled={!selectedClip}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Duplicate clip
              </button>
              <button
                type="button"
                onClick={() => {
                  applyEditorCommand("nudge left 1 beat", "quick-action");
                }}
                disabled={!selectedClip}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nudge left
              </button>
              <button
                type="button"
                onClick={() => {
                  applyEditorCommand("nudge right 1 beat", "quick-action");
                }}
                disabled={!selectedClip}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nudge right
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedClip}
                disabled={!selectedClip}
                className="rounded-full border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-500 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete clip
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Tempo
                </span>
                <span className="mt-2 block text-lg font-semibold text-stone-950">
                  {session.tempo.toFixed(1)} BPM
                </span>
              </label>
              <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Playhead
                </span>
                <input
                  type="range"
                  min={0}
                  max={session.totalBeats}
                  step={0.5}
                  value={session.playheadBeat}
                  onChange={(event) => {
                    setSession((current) => ({
                      ...current,
                      playheadBeat: Number(event.target.value),
                    }));
                  }}
                  className="mt-3 w-full accent-stone-900"
                />
                <span className="mt-2 block font-medium text-stone-900">
                  {formatBeatLabel(session.playheadBeat)}
                </span>
              </label>
              <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Timeline
                </span>
                <span className="mt-2 block text-lg font-semibold text-stone-950">
                  {barCount} bars
                </span>
                <button
                  type="button"
                  onClick={() => {
                    applyEditorCommand("extend timeline by 1 bar", "quick-action");
                  }}
                  className="mt-3 rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                >
                  Extend by 1 bar
                </button>
              </label>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[1.25rem] border border-stone-200 bg-stone-50">
            <div className="min-w-max">
              <div className="sticky top-0 z-20 border-b border-stone-200 bg-stone-100/90 backdrop-blur">
                <div className="flex">
                  <div
                    className="shrink-0 border-r border-stone-200 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-500"
                    style={{ width: TRACK_LABEL_WIDTH }}
                  >
                    Tracks
                  </div>
                  <div className="relative py-3" style={{ width: totalWidth }}>
                    {Array.from({ length: barCount }).map((_, index) => (
                      <div
                        key={`bar_${index + 1}`}
                        className="absolute top-0 bottom-0 border-l border-stone-200"
                        style={{ left: index * BEATS_PER_BAR * pixelsPerBeat }}
                      >
                        <span className="ml-2 text-xs font-medium text-stone-500">
                          Bar {index + 1}
                        </span>
                      </div>
                    ))}
                    <div
                      className="absolute top-0 bottom-0 z-10 w-px bg-amber-500"
                      style={{ left: session.playheadBeat * pixelsPerBeat }}
                    />
                  </div>
                </div>
              </div>

              {session.tracks.map((track) => {
                const trackClips = session.clips.filter((clip) => clip.trackId === track.id);
                return (
                  <div key={track.id} className="flex border-b border-stone-200 last:border-b-0">
                    <div
                      className="shrink-0 border-r border-stone-200 bg-white/70 px-4 py-4"
                      style={{ width: TRACK_LABEL_WIDTH }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: track.color }}
                            />
                            <p className="font-medium text-stone-900">{track.name}</p>
                          </div>
                          <p className="mt-2 text-sm text-stone-600">
                            Stem level {formatDb(track.stemLevelDb)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleToggleTrackMute(track.id);
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                              track.muted
                                ? "bg-amber-200 text-amber-950"
                                : "bg-stone-200 text-stone-700 hover:bg-stone-300"
                            }`}
                          >
                            M
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleToggleTrackSolo(track.id);
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                              track.solo
                                ? "bg-emerald-200 text-emerald-950"
                                : "bg-stone-200 text-stone-700 hover:bg-stone-300"
                            }`}
                          >
                            S
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="relative h-28" style={{ width: totalWidth }}>
                      {Array.from({ length: barCount }).map((_, index) => (
                        <div
                          key={`${track.id}_grid_${index}`}
                          className="absolute top-0 bottom-0 border-l border-stone-200/70"
                          style={{ left: index * BEATS_PER_BAR * pixelsPerBeat }}
                        />
                      ))}
                      <div
                        className="absolute top-0 bottom-0 z-10 w-px bg-amber-500"
                        style={{ left: session.playheadBeat * pixelsPerBeat }}
                      />

                      {trackClips.map((clip) => {
                        const isSelected = clip.id === session.selectedClipId;
                        const fadeInWidth = (clip.fadeInBeats / clip.clipLengthBeats) * 100;
                        const fadeOutWidth = (clip.fadeOutBeats / clip.clipLengthBeats) * 100;
                        return (
                          <div
                            key={clip.id}
                            className={`absolute top-4 h-20 rounded-xl border ${
                              isSelected
                                ? "border-stone-950 shadow-[0_12px_32px_rgba(17,21,26,0.16)]"
                                : "border-white/40"
                            }`}
                            style={{
                              left: clipLeft(clip, pixelsPerBeat),
                              width: clipWidth(clip, pixelsPerBeat),
                              backgroundColor: `${clip.color}22`,
                            }}
                            onPointerDown={(event) => {
                              startDrag(event, clip, "move");
                            }}
                            onClick={() => {
                              setSession((current) => ({
                                ...current,
                                selectedClipId: clip.id,
                              }));
                            }}
                          >
                            <div
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-xl bg-white/50"
                              onPointerDown={(event) => {
                                startDrag(event, clip, "trim-start");
                              }}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-xl bg-white/50"
                              onPointerDown={(event) => {
                                startDrag(event, clip, "trim-end");
                              }}
                            />
                            <div
                              className="absolute inset-y-0 left-0 rounded-l-xl bg-[linear-gradient(90deg,rgba(255,255,255,0.75),rgba(255,255,255,0))]"
                              style={{ width: `${fadeInWidth}%` }}
                            />
                            <div
                              className="absolute inset-y-0 right-0 rounded-r-xl bg-[linear-gradient(270deg,rgba(17,21,26,0.2),rgba(17,21,26,0))]"
                              style={{ width: `${fadeOutWidth}%` }}
                            />
                            <div className="relative flex h-full flex-col justify-between px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-stone-950">{clip.label}</p>
                                  <p className="mt-1 text-xs text-stone-700">
                                    start {formatBeatLabel(clip.clipStartBeat)} · length{" "}
                                    {formatBeatLabel(clip.clipLengthBeats)}
                                  </p>
                                </div>
                                <div className="flex gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-600">
                                  {clip.locked ? <span>Locked</span> : null}
                                  {clip.muted ? <span>Muted</span> : null}
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-xs text-stone-700">
                                <span>{formatDb(clip.gainDb)}</span>
                                <span>
                                  fade {clip.fadeInBeats.toFixed(1)} / {clip.fadeOutBeats.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
              Selected clip
            </p>
            {selectedClip ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-lg font-semibold text-stone-950">{selectedClip.label}</p>
                  <p className="mt-1 text-sm leading-7 text-stone-700">
                    Non-destructive source offset {formatBeatLabel(selectedClip.sourceStartBeat)}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                    <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                      Clip gain
                    </span>
                    <input
                      type="range"
                      min={-18}
                      max={18}
                      step={0.5}
                      value={selectedClip.gainDb}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        updateSelectedClip((clip) => ({ ...clip, gainDb: nextValue }));
                      }}
                      className="mt-3 w-full accent-stone-900"
                    />
                    <span className="mt-2 block font-medium text-stone-900">
                      {formatDb(selectedClip.gainDb)}
                    </span>
                  </label>

                  <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                    <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                      Fade in
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(selectedClip.clipLengthBeats - 0.5, 0)}
                      step={0.5}
                      value={selectedClip.fadeInBeats}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        updateSelectedClip((clip) => ({
                          ...clip,
                          fadeInBeats: nextValue,
                        }));
                      }}
                      className="mt-3 w-full accent-stone-900"
                    />
                    <span className="mt-2 block font-medium text-stone-900">
                      {formatBeatLabel(selectedClip.fadeInBeats)}
                    </span>
                  </label>

                  <label className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-700">
                    <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                      Fade out
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(selectedClip.clipLengthBeats - 0.5, 0)}
                      step={0.5}
                      value={selectedClip.fadeOutBeats}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        updateSelectedClip((clip) => ({
                          ...clip,
                          fadeOutBeats: nextValue,
                        }));
                      }}
                      className="mt-3 w-full accent-stone-900"
                    />
                    <span className="mt-2 block font-medium text-stone-900">
                      {formatBeatLabel(selectedClip.fadeOutBeats)}
                    </span>
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <button
                    type="button"
                    onClick={() => {
                      updateSelectedClip((clip) => ({ ...clip, locked: !clip.locked }));
                    }}
                    className={`rounded-full px-4 py-3 text-sm font-medium transition ${
                      selectedClip.locked
                        ? "bg-stone-950 text-stone-50 hover:bg-stone-800"
                        : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
                    }`}
                  >
                    {selectedClip.locked ? "Unlock clip" : "Lock clip"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateSelectedClip((clip) => ({ ...clip, muted: !clip.muted }));
                    }}
                    className={`rounded-full px-4 py-3 text-sm font-medium transition ${
                      selectedClip.muted
                        ? "bg-amber-200 text-amber-950 hover:bg-amber-300"
                        : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
                    }`}
                  >
                    {selectedClip.muted ? "Unmute clip" : "Mute clip"}
                  </button>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-4 text-sm leading-7 text-stone-700">
                  <p>
                    Timeline position: <span className="font-medium text-stone-950">{formatBeatLabel(selectedClip.clipStartBeat)}</span>
                  </p>
                  <p>
                    Region length: <span className="font-medium text-stone-950">{formatBeatLabel(selectedClip.clipLengthBeats)}</span>
                  </p>
                  <p>
                    Source available: <span className="font-medium text-stone-950">{formatBeatLabel(selectedClip.sourceLengthBeats)}</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-stone-700">
                Select a clip in the timeline to edit its position, fades, gain, and lock state.
              </p>
            )}
          </div>

          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
              Command history
            </p>
            <div className="mt-4 space-y-3">
              {session.commandHistory.length > 0 ? (
                session.commandHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-950">{entry.command}</p>
                        <p className="mt-2 text-sm leading-7 text-stone-700">{entry.summary}</p>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                          entry.status === "applied"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {entry.status}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-stone-500">
                      <span>{entry.scope}</span>
                      <span>
                        {entry.source.replace("-", " ")} · {formatCommandTime(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-4 py-6 text-sm leading-7 text-stone-700">
                  Quick actions and typed commands will build a visible edit trail here.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
              Why this matters
            </p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-stone-700">
              <p>Generation is no longer the whole product once clips become editable regions.</p>
              <p>Move and trim operations keep source offsets intact, which makes the edits non-destructive.</p>
              <p>
                Command-driven edits turn the timeline into an AI-native surface instead of
                a passive review page.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
