"use client";

import { Midi } from "@tonejs/midi";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type { ProjectDetail } from "@/lib/api";
import {
  applyConductrVoiceCommand,
  conductrFallbackDirection,
  defaultConductrParams,
} from "@/lib/conductr/director";
import { ConductrEngine } from "@/lib/conductr/engine";
import { ConductrEventBridge } from "@/lib/conductr/event-bridge";
import type { ConductrDirection, ConductrDirectorParams, ConductrEvent } from "@/lib/conductr/model";
import { CONDUCTR_TRACKS } from "@/lib/conductr/model";
import { LiveMidiInput, type MidiPortOption } from "@/lib/live-midi/midi-input";
import { MidiClock } from "@/lib/live-midi/midi-clock";
import { LiveMidiOutput } from "@/lib/live-midi/midi-output";
import { ParamInterpolator } from "@/lib/live-midi/param-interpolator";
import {
  type PerformanceMetrics,
  PerformanceAnalyzer,
} from "@/lib/live-midi/performance-analyzer";
import { ArcKnob } from "./arc-knob";
import { PatternGrid } from "./pattern-grid";
import { PerformancePads } from "./performance-pads";
import { PerformanceVisualizer } from "./performance-visualizer";

const USER_ECHO_CHANNEL = 4;

type ClockState = {
  bar: number;
  bpm: number;
  source: "external" | "internal";
  step: number;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
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

function formatPitch(midi: number | null): string {
  if (midi === null) {
    return "—";
  }
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[midi % 12] ?? "?"}${octave}`;
}

function transitionBars(transition: ConductrDirection["transition"]): number {
  if (transition === "immediate") {
    return 0;
  }
  if (transition === "gradual_4bars") {
    return 4;
  }
  return 2;
}

function patternsFromEngine(engine: ConductrEngine) {
  return {
    bass: engine.getTrackPattern("bass"),
    drums: engine.getTrackPattern("drums"),
    harmony: engine.getTrackPattern("harmony"),
    melody: engine.getTrackPattern("melody"),
  };
}

function significantChange(previous: PerformanceMetrics | null, next: PerformanceMetrics): boolean {
  if (!previous) {
    return true;
  }

  if (Math.abs(previous.avgVelocity - next.avgVelocity) >= 18) {
    return true;
  }
  if (Math.abs(previous.notesPerSecond - next.notesPerSecond) >= 1.5) {
    return true;
  }
  if (previous.detectedRoot !== next.detectedRoot || previous.detectedScale !== next.detectedScale) {
    return true;
  }
  const wasSilent = previous.silenceRatio > 0.85;
  const isSilent = next.silenceRatio > 0.85;
  return wasSilent !== isSilent;
}

function applyStageEntry(params: ConductrDirectorParams, barCount: number): ConductrDirectorParams {
  const trackMute: ConductrDirectorParams["trackMute"] = [...params.trackMute];
  if (barCount <= 1) {
    trackMute[1] = true;
    trackMute[2] = true;
    trackMute[3] = true;
  } else if (barCount === 2) {
    trackMute[2] = true;
    trackMute[3] = true;
  } else if (barCount === 3) {
    trackMute[3] = true;
  }
  return { ...params, trackMute };
}

function applyMelodyDucking(
  params: ConductrDirectorParams,
  metrics: PerformanceMetrics,
): ConductrDirectorParams {
  if (metrics.heldNoteCount === 0 || metrics.maxHoldMs < 550) {
    return params;
  }
  const trackMute: ConductrDirectorParams["trackMute"] = [...params.trackMute];
  trackMute[2] = true;
  return { ...params, trackMute };
}

function buildMidiBlob(
  project: ProjectDetail,
  bpm: number,
  engine: ConductrEngine,
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = `${project.name} Performance Mode`;

  CONDUCTR_TRACKS.forEach((trackId, trackIndex) => {
    const track = midi.addTrack();
    track.name = trackId;

    engine.getTrackPattern(trackId).forEach((event) => {
      if (event.velocity <= 0) {
        return;
      }
      track.addNote({
        duration: Math.max(event.duration, 1) / 4,
        midi: event.note,
        time: event.step / 4,
        velocity: event.velocity / 127,
      });
    });

    track.instrument.number = trackIndex === 0 ? 0 : 32 + trackIndex;
  });

  return new Blob([new Uint8Array(midi.toArray())], { type: "audio/midi" });
}

function stageLabel(bar: number): string {
  if (bar <= 1) {
    return "listen";
  }
  if (bar === 2) {
    return "drums + bass";
  }
  if (bar === 3) {
    return "add melody";
  }
  return "full band";
}

export function PerformanceMode({
  project,
  embedded = false,
}: {
  project: ProjectDetail;
  embedded?: boolean;
}) {
  const initialParams = defaultConductrParams(project);
  const initialBpm = project.analysis.bpm ?? 120;

  const [analyzer] = useState(() => new PerformanceAnalyzer());
  const [engine] = useState(() => new ConductrEngine(initialParams, 42));
  const [bridge] = useState(() => new ConductrEventBridge());
  const [interpolator] = useState(() => new ParamInterpolator<ConductrDirectorParams>(initialParams));
  const midiInputRef = useRef<LiveMidiInput | null>(null);
  const midiOutputRef = useRef<LiveMidiOutput | null>(null);
  const midiClockRef = useRef<MidiClock | null>(null);
  const lastMetricsRef = useRef<PerformanceMetrics | null>(null);
  const noteOffHandlerRef = useRef<(note: number, timestamp: number) => void>(() => {});
  const noteOnHandlerRef = useRef<(note: number, velocity: number, timestamp: number) => void>(
    () => {},
  );
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const currentParamsRef = useRef(initialParams);
  const currentBpmRef = useRef(initialBpm);
  const voiceTranscriptRef = useRef("");

  const [patterns, setPatterns] = useState(() => patternsFromEngine(engine));
  const [currentParams, setCurrentParams] = useState(initialParams);
  const [direction, setDirection] = useState<ConductrDirection>({
    musicalIntent: "Listening for a phrase before the band reacts",
    params: initialParams,
    transition: "gradual_2bars",
  });
  const [metrics, setMetrics] = useState<PerformanceMetrics>(defaultMetrics);
  const [clockState, setClockState] = useState<ClockState>({
    bar: 1,
    bpm: initialBpm,
    source: "internal",
    step: 1,
  });
  const [pulses, setPulses] = useState(() => bridge.snapshot());
  const [seed, setSeed] = useState(42);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputPorts, setInputPorts] = useState<MidiPortOption[]>([]);
  const [outputPorts, setOutputPorts] = useState<MidiPortOption[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [externalClockActive, setExternalClockActive] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening">("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [manualCommand, setManualCommand] = useState("");
  const [midiUrl, setMidiUrl] = useState<string | null>(null);

  useEffect(() => {
    currentParamsRef.current = currentParams;
  }, [currentParams]);

  useEffect(() => {
    currentBpmRef.current = clockState.bpm;
  }, [clockState.bpm]);

  useEffect(() => {
    voiceTranscriptRef.current = voiceTranscript;
  }, [voiceTranscript]);

  useEffect(() => {
    noteOnHandlerRef.current = (note: number, velocity: number, timestamp: number) => {
      analyzer.recordNote(note, velocity, timestamp);
      engine.feedNote(note, velocity);
      setMetrics(analyzer.analyze(timestamp));
      setPulses(bridge.onPlayerNote(2, velocity, timestamp));
      midiOutputRef.current?.sendNoteOn(USER_ECHO_CHANNEL, note, velocity);
      midiOutputRef.current?.scheduleNoteOff(USER_ECHO_CHANNEL, note, 180);
      setPatterns(patternsFromEngine(engine));
    };

    noteOffHandlerRef.current = (note: number, timestamp: number) => {
      analyzer.recordNoteOff(note);
      setMetrics(analyzer.analyze(timestamp));
      midiOutputRef.current?.sendNoteOff(USER_ECHO_CHANNEL, note);
    };
  }, [analyzer, bridge, engine]);

  function commitDirection(nextDirection: ConductrDirection) {
    setDirection(nextDirection);
    const transition = transitionBars(nextDirection.transition);
    interpolator.setTarget(nextDirection.params, transition);
    if (transition === 0) {
      engine.setParams(nextDirection.params);
      currentParamsRef.current = nextDirection.params;
      setCurrentParams(nextDirection.params);
      setPatterns(patternsFromEngine(engine));
    }
  }

  function applyImmediateParams(
    transform: (current: ConductrDirectorParams) => ConductrDirectorParams,
  ) {
    const nextParams = transform(currentParamsRef.current);
    engine.setParams(nextParams);
    currentParamsRef.current = nextParams;
    setCurrentParams(nextParams);
    setDirection((currentDirection) => ({
      ...currentDirection,
      params: nextParams,
      transition: "immediate",
    }));
    setPatterns(patternsFromEngine(engine));
  }

  const evaluateDirector = useEffectEvent((barCount: number) => {
    const nextMetrics = analyzer.analyze();
    const reactive = significantChange(lastMetricsRef.current, nextMetrics);
    lastMetricsRef.current = nextMetrics;
    setMetrics(nextMetrics);

    if (barCount % 4 !== 0 && !reactive) {
      return;
    }

    const baseDirection = conductrFallbackDirection(nextMetrics, currentParamsRef.current);
    const stagedParams = applyStageEntry(baseDirection.params, barCount);
    const duckedParams = applyMelodyDucking(stagedParams, nextMetrics);
    commitDirection({
      ...baseDirection,
      params: duckedParams,
    });
  });

  const handleTick = useEffectEvent((source: "external" | "internal", bpm: number) => {
    engine.setBpm(bpm);
    const tick = engine.tick();
    setPatterns(tick.patterns);
    setPulses(bridge.onTick(tick.events));
    setClockState({
      bar: tick.barCount + 1,
      bpm,
      source,
      step: tick.step + 1,
    });

    const stepDurationMs = Math.round(60000 / bpm / 4);
    tick.events.forEach((event: ConductrEvent) => {
      midiOutputRef.current?.sendNoteOn(event.channel, event.note, event.velocity);
      midiOutputRef.current?.scheduleNoteOff(
        event.channel,
        event.note,
        Math.max(stepDurationMs - 12, 60) * Math.max(event.duration, 1),
      );
    });

    if (tick.step === 0) {
      if (interpolator.isTransitioning) {
        const nextParams = interpolator.tick();
        engine.setParams(nextParams);
        currentParamsRef.current = nextParams;
        setCurrentParams(nextParams);
        setPatterns(patternsFromEngine(engine));
      }
      evaluateDirector(tick.barCount + 1);
    }
  });

  useEffect(() => {
    midiInputRef.current = new LiveMidiInput({
      onNoteOn: (note, velocity, timestamp) => {
        noteOnHandlerRef.current(note, velocity, timestamp);
      },
      onNoteOff: (note, timestamp) => {
        noteOffHandlerRef.current(note, timestamp);
      },
      onRawMessage: (event) => {
        midiClockRef.current?.handleMessage(event);
      },
    });
    midiOutputRef.current = new LiveMidiOutput();
    midiClockRef.current = new MidiClock({
      onBpmChange: (bpm) => {
        setClockState((current) => ({ ...current, bpm, source: "external" }));
      },
      onClockDetected: () => {
        setExternalClockActive(true);
      },
      onClockLost: () => {
        setExternalClockActive(false);
      },
      onContinue: () => {
        engine.resume();
        setIsPlaying(true);
      },
      onPositionChange: (step, bar) => {
        engine.setPosition(step, bar);
        setClockState((current) => ({
          ...current,
          bar: bar + 1,
          source: "external",
          step: step + 1,
        }));
      },
      onStart: () => {
        engine.start();
        setIsPlaying(true);
      },
      onStep: () => {
        handleTick("external", midiClockRef.current?.bpm || currentBpmRef.current);
      },
      onStop: () => {
        engine.stop();
        setIsPlaying(false);
      },
    });
    midiClockRef.current.enable();

    return () => {
      midiClockRef.current?.disable();
      midiInputRef.current?.dispose();
      midiOutputRef.current?.allNotesOff();
    };
  }, [engine]);

  useEffect(() => {
    return () => {
      if (midiUrl) {
        URL.revokeObjectURL(midiUrl);
      }
    };
  }, [midiUrl]);

  useEffect(() => {
    midiInputRef.current?.selectPort(selectedInputId);
  }, [selectedInputId]);

  useEffect(() => {
    midiOutputRef.current?.selectPort(selectedOutputId);
  }, [selectedOutputId]);

  useEffect(() => {
    if (!isPlaying || externalClockActive) {
      return;
    }

    const bpm = clockState.bpm || 120;
    const intervalMs = Math.max(60, Math.round(60000 / bpm / 4));
    const intervalId = window.setInterval(() => {
      handleTick("internal", bpm);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [clockState.bpm, externalClockActive, isPlaying]);

  async function connectMidi() {
    if (!navigator.requestMIDIAccess) {
      setError("Web MIDI is not available in this browser.");
      return;
    }

    setError(null);
    try {
      const access = await navigator.requestMIDIAccess();
      midiInputRef.current?.setAccess(access);
      midiOutputRef.current?.setAccess(access);

      const nextInputPorts = midiInputRef.current?.getPorts() ?? [];
      const nextOutputPorts = midiOutputRef.current?.getPorts() ?? [];
      setInputPorts(nextInputPorts);
      setOutputPorts(nextOutputPorts);

      const nextInputId = selectedInputId || nextInputPorts[0]?.id || "";
      const nextOutputId = selectedOutputId || nextOutputPorts[0]?.id || "";
      if (nextInputId) {
        midiInputRef.current?.selectPort(nextInputId);
      }
      if (nextOutputId) {
        midiOutputRef.current?.selectPort(nextOutputId);
      }
      setSelectedInputId(nextInputId);
      setSelectedOutputId(nextOutputId);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect MIDI.");
    }
  }

  function handleStartStop() {
    if (isPlaying) {
      engine.stop();
      midiOutputRef.current?.allNotesOff();
      setIsPlaying(false);
      return;
    }

    engine.start();
    setIsPlaying(true);
    setClockState((current) => ({
      ...current,
      bar: 1,
      source: externalClockActive ? "external" : "internal",
      step: 1,
    }));
  }

  function handleRegenerate() {
    engine.regenerate();
    setPatterns(patternsFromEngine(engine));
    setPulses(bridge.snapshot());
  }

  function handleSeedChange(nextSeed: number) {
    setSeed(nextSeed);
    engine.setSeed(nextSeed);
    setPatterns(patternsFromEngine(engine));
  }

  function runCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }
    const nextDirection = applyConductrVoiceCommand(trimmed, currentParamsRef.current, metrics);
    commitDirection(nextDirection);
    setManualCommand("");
    setVoiceTranscript(trimmed);
  }

  function toggleVoiceRecognition() {
    const SpeechCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setError("Web Speech recognition is not available in this browser.");
      return;
    }

    if (voiceRecognitionRef.current) {
      voiceRecognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      setVoiceState("listening");
      setError(null);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript = event.results[index]?.[0]?.transcript ?? transcript;
      }
      voiceTranscriptRef.current = transcript;
      setVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => {
      setError(`Voice command failed: ${event.error}`);
    };
    recognition.onend = () => {
      const finalTranscript = voiceTranscriptRef.current.trim();
      if (finalTranscript) {
        runCommand(finalTranscript);
      }
      voiceRecognitionRef.current = null;
      setVoiceState("idle");
    };
    voiceRecognitionRef.current = recognition;
    recognition.start();
  }

  function buildMidiDownload() {
    if (midiUrl) {
      URL.revokeObjectURL(midiUrl);
    }
    const blob = buildMidiBlob(project, clockState.bpm || 120, engine);
    const url = URL.createObjectURL(blob);
    setMidiUrl(url);
  }

  return (
    <div
      id="performance-lane"
      className={embedded ? "space-y-6" : "mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-6 pb-10 sm:px-10 lg:px-16"}
    >
      <section className="glass-card rounded-[1.75rem] px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">{embedded ? "Performance Deck" : "Performance Mode"}</span>
              <StatusPill label={isPlaying ? "running" : "stopped"} tone={isPlaying ? "online" : "neutral"} />
              <StatusPill
                label={externalClockActive ? "external clock" : "internal clock"}
                tone={externalClockActive ? "online" : "neutral"}
              />
            </div>
            <div>
              <h2
                className={`font-semibold tracking-[-0.05em] text-stone-950 ${
                  embedded ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"
                }`}
              >
                {embedded
                  ? "Conductr live engine inside the studio"
                  : `${project.name} · Conductr Performance Lane`}
              </h2>
              <p className="mt-3 max-w-3xl text-base leading-7 text-stone-700">
                {embedded
                  ? "This deck keeps live generation, MIDI routing, direction prompts, and procedural pattern control inside the same workspace as the editor."
                  : "This lane brings Conductr-style live generation into codex-music without replacing the editor. Play notes, steer the arrangement, then export the resulting pattern sketch back out as MIDI."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={`${clockState.bpm} BPM`} tone="neutral" />
              <StatusPill label={`Bar ${clockState.bar}`} tone="neutral" />
              <StatusPill label={`Step ${clockState.step}`} tone="neutral" />
              <StatusPill label={`Stage ${stageLabel(clockState.bar)}`} tone="neutral" />
              <StatusPill label={direction.transition} tone="neutral" />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void connectMidi();
              }}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
            >
              Connect MIDI
            </button>
            <button
              type="button"
              onClick={handleStartStop}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
            >
              {isPlaying ? "Stop transport" : "Start transport"}
            </button>
            <button
              type="button"
              onClick={handleRegenerate}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
            >
              Regenerate patterns
            </button>
            <button
              type="button"
              onClick={() => {
                midiOutputRef.current?.allNotesOff();
              }}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
            >
              All notes off
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
            {error}
          </p>
        ) : null}
      </section>

      <section className={`grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px] ${embedded ? "" : "mt-8"}`}>
        <div className="space-y-8">
          <PatternGrid patterns={patterns} step={clockState.step - 1} />
          <PerformanceVisualizer pulses={pulses} />
          <PerformancePads
            onNoteOn={(note, velocity) => {
              noteOnHandlerRef.current(note, velocity, performance.now());
            }}
            onNoteOff={(note) => {
              noteOffHandlerRef.current(note, performance.now());
            }}
          />
        </div>

        <div className="space-y-8">
          <article className="glass-card rounded-[1.5rem] p-6">
            <p className="eyebrow">Director</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
              Non-blocking arrangement guidance
            </h2>
            <p className="mt-3 text-sm leading-7 text-stone-700">{direction.musicalIntent}</p>
            {direction.suggestion ? (
              <p className="mt-3 rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                {direction.suggestion}
              </p>
            ) : null}

            <div className="mt-5 rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Voice or typed direction</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={manualCommand}
                  onChange={(event) => {
                    setManualCommand(event.target.value);
                  }}
                  placeholder="make it funky, only drums, shift to minor..."
                  className="min-w-[220px] flex-1 rounded-full border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-900"
                />
                <button
                  type="button"
                  onClick={() => {
                    runCommand(manualCommand);
                  }}
                  className="rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceRecognition}
                  className="rounded-full border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                >
                  {voiceState === "listening" ? "Stop voice" : "Voice command"}
                </button>
              </div>
              {voiceTranscript ? (
                <p className="mt-3 text-sm text-stone-600">Transcript: {voiceTranscript}</p>
              ) : null}
            </div>
          </article>

          <article className="glass-card rounded-[1.5rem] p-6">
            <p className="eyebrow">Metrics</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
              Performer analysis
            </h2>
            <div className="mt-5 section-grid">
              <div className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-stone-500">Notes / sec</p>
                <p className="mt-2 text-2xl font-semibold text-stone-950">
                  {metrics.notesPerSecond.toFixed(2)}
                </p>
              </div>
              <div className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-stone-500">Avg velocity</p>
                <p className="mt-2 text-2xl font-semibold text-stone-950">{metrics.avgVelocity}</p>
              </div>
              <div className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-stone-500">Key</p>
                <p className="mt-2 text-lg font-semibold text-stone-950">
                  {metrics.detectedRootName ? `${metrics.detectedRootName} ${metrics.detectedScale}` : "Pending"}
                </p>
              </div>
              <div className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-stone-500">Range</p>
                <p className="mt-2 text-lg font-semibold text-stone-950">
                  {metrics.pitchRangeSemitones} semitones
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-[1rem] border border-stone-200 bg-stone-50 p-4 text-sm leading-7 text-stone-700">
              Lowest note: {formatPitch(metrics.lowestNote)} · Highest note:{" "}
              {formatPitch(metrics.highestNote)} · Held notes: {metrics.heldNoteCount} · Max
              hold: {metrics.maxHoldMs}ms
            </div>
          </article>

          <article className="glass-card rounded-[1.5rem] p-6">
            <p className="eyebrow">Routing</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
              MIDI bridge and export
            </h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                <span className="block text-sm text-stone-500">MIDI input</span>
                <select
                  value={selectedInputId}
                  onChange={(event) => {
                    setSelectedInputId(event.target.value);
                  }}
                  className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                >
                  <option value="">No input selected</option>
                  {inputPorts.map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.name ?? port.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[1rem] border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                <span className="block text-sm text-stone-500">MIDI output</span>
                <select
                  value={selectedOutputId}
                  onChange={(event) => {
                    setSelectedOutputId(event.target.value);
                  }}
                  className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                >
                  <option value="">Visual only</option>
                  {outputPorts.map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.name ?? port.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 rounded-[1rem] border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Conductr controls</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ArcKnob
                  label="Seed"
                  min={1}
                  max={128}
                  value={seed}
                  onChange={handleSeedChange}
                />
                <ArcKnob
                  label="Swing"
                  min={0}
                  max={127}
                  value={Math.round(currentParams.swing)}
                  onChange={(value) => {
                    applyImmediateParams((current) => ({
                      ...current,
                      swing: value,
                    }));
                  }}
                />
                <ArcKnob
                  label="Melody density"
                  min={0}
                  max={127}
                  value={Math.round(currentParams.melodyDensity)}
                  onChange={(value) => {
                    applyImmediateParams((current) => ({
                      ...current,
                      melodyDensity: value,
                    }));
                  }}
                />
                <ArcKnob
                  label="Bass movement"
                  min={0}
                  max={127}
                  value={Math.round(currentParams.bassMovement)}
                  onChange={(value) => {
                    applyImmediateParams((current) => ({
                      ...current,
                      bassMovement: value,
                    }));
                  }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={buildMidiDownload}
                className="rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Build MIDI export
              </button>
              {midiUrl ? (
                <a
                  href={midiUrl}
                  download={`${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-conductr-performance.mid`}
                  className="rounded-full border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100"
                >
                  Download .mid
                </a>
              ) : null}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
