"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Midi } from "@tonejs/midi";

import type { ProjectDetail } from "@/lib/api";
import {
  type DirectorParams,
  fallbackDirector,
} from "@/lib/live-midi/fallback-director";
import {
  type PerformanceMetrics,
  PerformanceAnalyzer,
} from "@/lib/live-midi/performance-analyzer";
import { LiveMidiInput, type MidiPortOption } from "@/lib/live-midi/midi-input";
import { MidiClock } from "@/lib/live-midi/midi-clock";
import { LiveMidiOutput } from "@/lib/live-midi/midi-output";
import { ParamInterpolator } from "@/lib/live-midi/param-interpolator";

type CapturedNote = {
  id: string;
  note: number;
  velocity: number;
  startMs: number;
  endMs: number | null;
};

const USER_ECHO_CHANNEL = 4;
const STEPS_PER_BAR = 16;

type ClockState = {
  bar: number;
  bpm: number;
  source: "external" | "internal";
  step: number;
};

function formatPitch(midi: number | null): string {
  if (midi === null) {
    return "—";
  }

  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[midi % 12] ?? "?"}${octave}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function defaultMetrics(): PerformanceMetrics {
  return {
    notesPerSecond: 0,
    avgVelocity: 0,
    velocityTrend: 0,
    pitchRangeSemitones: 0,
    lowestNote: null,
    highestNote: null,
    silenceRatio: 1,
    detectedRoot: null,
    detectedRootName: null,
    detectedScale: null,
    keyConfidence: 0,
    heldNoteCount: 0,
    maxHoldMs: 0,
  };
}

function defaultDirectorParams(project: ProjectDetail): DirectorParams {
  return {
    drumDensity: 64,
    bassMovement: 60,
    melodyDensity: 58,
    melodyComplexity: 50,
    swing: 32,
    scale: project.analysis.musical_key?.toLowerCase().includes("minor") ? "minor" : "major",
    root: null,
    trackMute: [false, false, false, false],
  };
}

function buildMidiFilename(project: ProjectDetail): string {
  return `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-live-capture.mid`;
}

function transitionSteps(transition: "immediate" | "gradual_2bars" | "gradual_4bars"): number {
  if (transition === "immediate") {
    return 0;
  }
  if (transition === "gradual_4bars") {
    return 64;
  }
  return 32;
}

export function LiveMidiLab({ project }: { project: ProjectDetail }) {
  const analyzerRef = useRef(new PerformanceAnalyzer());
  const midiInputRef = useRef<LiveMidiInput | null>(null);
  const midiOutputRef = useRef<LiveMidiOutput | null>(null);
  const midiClockRef = useRef<MidiClock | null>(null);
  const interpolatorRef = useRef(
    new ParamInterpolator<DirectorParams>(defaultDirectorParams(project)),
  );
  const activeNoteIdsRef = useRef<Map<number, string[]>>(new Map());
  const captureRef = useRef<CapturedNote[]>([]);
  const [inputPorts, setInputPorts] = useState<MidiPortOption[]>([]);
  const [outputPorts, setOutputPorts] = useState<MidiPortOption[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentNotes, setRecentNotes] = useState<CapturedNote[]>([]);
  const [capturedNotes, setCapturedNotes] = useState<CapturedNote[]>([]);
  const [metrics, setMetrics] = useState<PerformanceMetrics>(defaultMetrics);
  const [directorParams, setDirectorParams] = useState<DirectorParams>(
    defaultDirectorParams(project),
  );
  const [directorIntent, setDirectorIntent] = useState("Listening for your first phrase");
  const [directorTransition, setDirectorTransition] = useState<
    "immediate" | "gradual_2bars" | "gradual_4bars"
  >("gradual_2bars");
  const [clockState, setClockState] = useState<ClockState>({
    bar: 1,
    bpm: project.analysis.bpm ?? 120,
    source: "internal",
    step: 1,
  });
  const [externalClockActive, setExternalClockActive] = useState(false);
  const [midiUrl, setMidiUrl] = useState<string | null>(null);

  const handleTransportStep = useEffectEvent((source: "external" | "internal", bpm: number) => {
    const nextParams = interpolatorRef.current.tick();
    setDirectorParams(nextParams);
    setClockState((current) => {
      const rawStep = current.step % STEPS_PER_BAR;
      const nextStep = rawStep + 1;
      const nextBar = nextStep === 1 ? current.bar + 1 : current.bar;
      return { bar: nextBar, bpm, source, step: nextStep };
    });
  });

  const handleNoteOn = useEffectEvent((note: number, velocity: number, timestamp: number) => {
    analyzerRef.current.recordNote(note, velocity, timestamp);

    const noteId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `capture_${Math.random().toString(16).slice(2, 10)}`;
    const capturedNote: CapturedNote = {
      id: noteId,
      note,
      velocity,
      startMs: timestamp,
      endMs: null,
    };

    const noteIds = activeNoteIdsRef.current.get(note) ?? [];
    activeNoteIdsRef.current.set(note, [...noteIds, noteId]);

    captureRef.current = [...captureRef.current, capturedNote];
    setCapturedNotes(captureRef.current);
    setRecentNotes((current) => [capturedNote, ...current].slice(0, 10));
    midiOutputRef.current?.sendNoteOn(USER_ECHO_CHANNEL, note, velocity);
  });

  const handleNoteOff = useEffectEvent((note: number, timestamp: number) => {
    analyzerRef.current.recordNoteOff(note);

    const stack = activeNoteIdsRef.current.get(note) ?? [];
    const activeId = stack[stack.length - 1] ?? null;
    if (activeId) {
      activeNoteIdsRef.current.set(note, stack.slice(0, -1));
      captureRef.current = captureRef.current.map((captured) =>
        captured.id === activeId ? { ...captured, endMs: timestamp } : captured,
      );
      setCapturedNotes(captureRef.current);
    }

    midiOutputRef.current?.sendNoteOff(USER_ECHO_CHANNEL, note);
  });

  const handleClockMessage = useEffectEvent((event: MIDIMessageEvent) => {
    midiClockRef.current?.handleMessage(event);
  });

  const handleExternalClockStep = useEffectEvent(() => {
    handleTransportStep("external", midiClockRef.current?.bpm || project.analysis.bpm || 120);
  });

  useEffect(() => {
    midiInputRef.current = new LiveMidiInput({
      onNoteOn: handleNoteOn,
      onNoteOff: handleNoteOff,
      onRawMessage: handleClockMessage,
    });
    midiOutputRef.current = new LiveMidiOutput();
    midiClockRef.current = new MidiClock({
      onStep: handleExternalClockStep,
      onStart: () => {
        setClockState((current) => ({ ...current, bar: 1, source: "external", step: 1 }));
        setExternalClockActive(true);
      },
      onStop: () => {
        setExternalClockActive(false);
      },
      onContinue: () => {
        setExternalClockActive(true);
      },
      onBpmChange: (bpm) => {
        setClockState((current) => ({ ...current, bpm, source: "external" }));
      },
      onPositionChange: (step, bar) => {
        setClockState((current) => ({
          ...current,
          bar: bar + 1,
          source: "external",
          step: (step % STEPS_PER_BAR) + 1,
        }));
      },
      onClockDetected: () => {
        setExternalClockActive(true);
      },
      onClockLost: () => {
        setExternalClockActive(false);
      },
    });
    midiClockRef.current.enable();

    return () => {
      midiClockRef.current?.disable();
      midiInputRef.current?.dispose();
      midiOutputRef.current?.allNotesOff();
    };
  }, []);

  useEffect(() => {
    return () => {
      midiInputRef.current?.dispose();
      midiOutputRef.current?.allNotesOff();
      if (midiUrl) {
        URL.revokeObjectURL(midiUrl);
      }
    };
  }, [midiUrl]);

  useEffect(() => {
    if (!midiAccess) {
      return;
    }

    midiInputRef.current?.setAccess(midiAccess);
    midiOutputRef.current?.setAccess(midiAccess);
    midiInputRef.current?.selectPort(selectedInputId);
    midiOutputRef.current?.selectPort(selectedOutputId);
  }, [midiAccess, selectedInputId, selectedOutputId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextMetrics = analyzerRef.current.analyze();
      setMetrics(nextMetrics);
      const snapshot = fallbackDirector(nextMetrics, interpolatorRef.current.current);
      interpolatorRef.current.setTarget(snapshot.params, transitionSteps(snapshot.transition));
      setDirectorIntent(snapshot.musicalIntent);
      setDirectorTransition(snapshot.transition);
      if (!interpolatorRef.current.isTransitioning) {
        setDirectorParams(snapshot.params);
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (externalClockActive) {
      return;
    }

    const bpm = Math.max(40, clockState.bpm || project.analysis.bpm || 120);
    const intervalMs = 60000 / bpm / 4;
    const intervalId = window.setInterval(() => {
      handleTransportStep("internal", bpm);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [clockState.bpm, externalClockActive, project.analysis.bpm]);

  async function connectMidi(): Promise<void> {
    if (!("requestMIDIAccess" in navigator)) {
      setError("Web MIDI is not available in this browser. Chrome-based browsers work best.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const access = await navigator.requestMIDIAccess();
      setMidiAccess(access);
      midiInputRef.current?.setAccess(access);
      midiOutputRef.current?.setAccess(access);

      const syncPorts = () => {
        const nextInputs = midiInputRef.current?.getPorts() ?? [];
        const nextOutputs = midiOutputRef.current?.getPorts() ?? [];
        setInputPorts(nextInputs);
        setOutputPorts(nextOutputs);
        setSelectedInputId((current) =>
          nextInputs.some((port) => port.id === current) ? current : (nextInputs[0]?.id ?? ""),
        );
        setSelectedOutputId((current) =>
          nextOutputs.some((port) => port.id === current) ? current : current || "",
        );
      };

      syncPorts();
      access.onstatechange = () => {
        syncPorts();
      };
    } catch (connectionError) {
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Could not access MIDI devices.",
      );
    } finally {
      setIsConnecting(false);
    }
  }

  function clearCapture(): void {
    analyzerRef.current.reset();
    activeNoteIdsRef.current.clear();
    midiOutputRef.current?.allNotesOff();
    captureRef.current = [];
    setCapturedNotes([]);
    setRecentNotes([]);
    setMetrics(defaultMetrics());
    const nextDefaultParams = defaultDirectorParams(project);
    interpolatorRef.current.setCurrent(nextDefaultParams);
    setDirectorParams(nextDefaultParams);
    setDirectorIntent("Listening for your first phrase");
    setDirectorTransition("gradual_2bars");
    if (midiUrl) {
      URL.revokeObjectURL(midiUrl);
      setMidiUrl(null);
    }
  }

  function exportCapture(): void {
    if (capturedNotes.length === 0) {
      return;
    }

    const midi = new Midi();
    midi.header.setTempo(project.analysis.bpm ?? 120);
    const track = midi.addTrack();
    const firstStart = capturedNotes[0]?.startMs ?? performance.now();

    for (const note of capturedNotes) {
      const startTimeSeconds = Math.max(0, (note.startMs - firstStart) / 1000);
      const endMs = note.endMs ?? note.startMs + 220;
      const durationSeconds = Math.max(0.12, (endMs - note.startMs) / 1000);

      track.addNote({
        midi: note.note,
        time: startTimeSeconds,
        duration: durationSeconds,
        velocity: Math.min(Math.max(note.velocity / 127, 0.1), 1),
      });
    }

    const bytes = midi.toArray();
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    if (midiUrl) {
      URL.revokeObjectURL(midiUrl);
    }

    setMidiUrl(URL.createObjectURL(new Blob([arrayBuffer], { type: "audio/midi" })));
  }

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Live MIDI</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Performance capture and browser-side director
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            This lane adapts the strongest ideas from Conductr: Web MIDI input,
            live performance analysis, external clock following, smoothed
            parameter transitions, and a fast fallback musical director that
            reacts to what you play without waiting on a model round-trip.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void connectMidi();
          }}
          disabled={isConnecting}
          className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {isConnecting ? "Connecting MIDI..." : midiAccess ? "Refresh MIDI ports" : "Connect MIDI"}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-[1.25rem] bg-amber-100 px-4 py-3 text-sm leading-7 text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
          <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            MIDI input
          </span>
          <select
            value={selectedInputId}
            onChange={(event) => {
              setSelectedInputId(event.target.value);
            }}
            className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none"
          >
            <option value="">Select an input port</option>
            {inputPorts.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name ?? port.id}
              </option>
            ))}
          </select>
        </label>

        <label className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
          <span className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            MIDI output echo
          </span>
          <select
            value={selectedOutputId}
            onChange={(event) => {
              setSelectedOutputId(event.target.value);
            }}
            className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none"
          >
            <option value="">No output echo</option>
            {outputPorts.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name ?? port.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Notes per second</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{metrics.notesPerSecond}</p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Average velocity</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{metrics.avgVelocity}</p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Detected key</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {metrics.detectedRootName && metrics.detectedScale
              ? `${metrics.detectedRootName} ${metrics.detectedScale}`
              : "Listening..."}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Silence ratio</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {formatPercent(metrics.silenceRatio)}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Clock source</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {externalClockActive ? "External MIDI clock" : "Internal transport"}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Clock BPM</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{clockState.bpm}</p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Transport</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            Bar {clockState.bar} · Step {clockState.step}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Key confidence</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {formatPercent(metrics.keyConfidence)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Recent incoming notes</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentNotes.length > 0 ? (
              recentNotes.map((note) => (
                <span
                  key={note.id}
                  className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm text-emerald-900"
                >
                  {formatPitch(note.note)} · v{note.velocity}
                </span>
              ))
            ) : (
              <span className="text-sm text-stone-600">
                Play a controller into the selected port to start capture.
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Held notes</p>
              <p className="mt-2 font-semibold text-stone-950">{metrics.heldNoteCount}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Range</p>
              <p className="mt-2 font-semibold text-stone-950">
                {formatPitch(metrics.lowestNote)} - {formatPitch(metrics.highestNote)}
              </p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Longest hold</p>
              <p className="mt-2 font-semibold text-stone-950">{metrics.maxHoldMs} ms</p>
            </div>
          </div>
        </div>

        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Director reaction</p>
          <p className="mt-3 text-lg font-semibold text-stone-950">
            {directorIntent}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Scale target</p>
              <p className="mt-2 font-semibold text-stone-950">
                {directorParams.root !== null && metrics.detectedRootName
                  ? `${metrics.detectedRootName} ${directorParams.scale}`
                  : directorParams.scale}
              </p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Transition</p>
              <p className="mt-2 font-semibold text-stone-950">{directorTransition}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Drum density</p>
              <p className="mt-2 font-semibold text-stone-950">{Math.round(directorParams.drumDensity)}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Melody complexity</p>
              <p className="mt-2 font-semibold text-stone-950">
                {Math.round(directorParams.melodyComplexity)}
              </p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Bass movement</p>
              <p className="mt-2 font-semibold text-stone-950">{Math.round(directorParams.bassMovement)}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white/80 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Muted tracks</p>
              <p className="mt-2 font-semibold text-stone-950">
                {directorParams.trackMute.filter(Boolean).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            exportCapture();
          }}
          disabled={capturedNotes.length === 0}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Build MIDI export
        </button>
        <button
          type="button"
          onClick={() => {
            clearCapture();
          }}
          disabled={capturedNotes.length === 0}
          className="rounded-full border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-500 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear capture
        </button>
        <button
          type="button"
          onClick={() => {
            midiOutputRef.current?.allNotesOff();
          }}
          disabled={!selectedOutputId}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send all notes off
        </button>
        {midiUrl ? (
          <a
            href={midiUrl}
            download={buildMidiFilename(project)}
            className="inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Download captured .mid
          </a>
        ) : null}
      </div>
    </article>
  );
}
