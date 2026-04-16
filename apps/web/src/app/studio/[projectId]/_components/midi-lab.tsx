"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteEventTime } from "@spotify/basic-pitch";

import type { ProjectDetail } from "@/lib/api";
import { resolveApiUrl } from "@/lib/api";

const BASIC_PITCH_MODEL_URL = "https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json";

type MidiSketchState =
  | {
      status: "idle";
      progress: number;
      notes: NoteEventTime[];
      midiUrl: null;
      error: null;
    }
  | {
      status: "running";
      progress: number;
      notes: NoteEventTime[];
      midiUrl: null;
      error: null;
    }
  | {
      status: "ready";
      progress: number;
      notes: NoteEventTime[];
      midiUrl: string;
      error: null;
    }
  | {
      status: "error";
      progress: number;
      notes: NoteEventTime[];
      midiUrl: null;
      error: string;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatPitch(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12] ?? "?"}${octave}`;
}

function noteRange(notes: NoteEventTime[]): string {
  if (notes.length === 0) {
    return "—";
  }

  const pitches = notes.map((note) => note.pitchMidi);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  return `${formatPitch(minPitch)} to ${formatPitch(maxPitch)}`;
}

function buildDownloadFilename(project: ProjectDetail): string {
  return `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-midi-sketch.mid`;
}

export function MidiLab({ project }: { project: ProjectDetail }) {
  const audioSource = resolveApiUrl(project.audio_path ?? project.polished_audio_path);
  const [state, setState] = useState<MidiSketchState>({
    status: "idle",
    progress: 0,
    notes: [],
    midiUrl: null,
    error: null,
  });
  const midiUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (midiUrlRef.current) {
        URL.revokeObjectURL(midiUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setState({
      status: "idle",
      progress: 0,
      notes: [],
      midiUrl: null,
      error: null,
    });
    if (midiUrlRef.current) {
      URL.revokeObjectURL(midiUrlRef.current);
      midiUrlRef.current = null;
    }
  }, [audioSource, project.id]);

  async function handleExtractMidi() {
    if (!audioSource) {
      setState({
        status: "error",
        progress: 0,
        notes: [],
        midiUrl: null,
        error: "Source audio is not available in this session yet.",
      });
      return;
    }

    try {
      if (midiUrlRef.current) {
        URL.revokeObjectURL(midiUrlRef.current);
        midiUrlRef.current = null;
      }

      setState({
        status: "running",
        progress: 0,
        notes: [],
        midiUrl: null,
        error: null,
      });

      const [{ BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly }, { Midi }] =
        await Promise.all([import("@spotify/basic-pitch"), import("@tonejs/midi")]);

      const audioResponse = await fetch(audioSource);
      if (!audioResponse.ok) {
        throw new Error(`Could not load project audio (${audioResponse.status}).`);
      }

      const arrayBuffer = await audioResponse.arrayBuffer();
      const audioContext = new window.AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const predictor = new BasicPitch(BASIC_PITCH_MODEL_URL);
      const frames: number[][] = [];
      const onsets: number[][] = [];
      const contours: number[][] = [];

      await predictor.evaluateModel(
        audioBuffer,
        (nextFrames, nextOnsets, nextContours) => {
          frames.push(...nextFrames);
          onsets.push(...nextOnsets);
          contours.push(...nextContours);
        },
        (percent) => {
          setState((current) => ({
            status: "running",
            progress: percent,
            notes: current.notes,
            midiUrl: null,
            error: null,
          }));
        },
      );

      await audioContext.close();

      const detectedNotes = noteFramesToTime(
        addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.2, 5)),
      );

      if (detectedNotes.length === 0) {
        throw new Error("No clear monophonic or polyphonic note events were detected.");
      }

      const midi = new Midi();
      midi.header.setTempo(project.analysis.bpm ?? 120);
      const track = midi.addTrack();

      detectedNotes.forEach((note) => {
        track.addNote({
          midi: note.pitchMidi,
          time: note.startTimeSeconds,
          duration: note.durationSeconds,
          velocity: clamp(note.amplitude, 0.15, 1),
        });
      });

      const midiBytes = midi.toArray();
      const midiBuffer = midiBytes.buffer.slice(
        midiBytes.byteOffset,
        midiBytes.byteOffset + midiBytes.byteLength,
      ) as ArrayBuffer;
      const nextMidiUrl = URL.createObjectURL(
        new Blob([midiBuffer], { type: "audio/midi" }),
      );

      if (midiUrlRef.current) {
        URL.revokeObjectURL(midiUrlRef.current);
      }
      midiUrlRef.current = nextMidiUrl;

      setState({
        status: "ready",
        progress: 1,
        notes: detectedNotes,
        midiUrl: nextMidiUrl,
        error: null,
      });
    } catch (error) {
      setState({
        status: "error",
        progress: 0,
        notes: [],
        midiUrl: null,
        error:
          error instanceof Error
            ? error.message
            : "The MIDI sketch could not be generated for this audio yet.",
      });
    }
  }

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">MIDI Lane</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            Browser-side audio to MIDI sketch
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-700">
            This lane uses Spotify Basic Pitch in the browser so the studio can turn
            project audio into editable notes without waiting on a separate backend pass.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void handleExtractMidi();
          }}
          disabled={!audioSource || state.status === "running"}
          className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {state.status === "running" ? "Extracting MIDI..." : "Generate MIDI sketch"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Input</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {audioSource ? "Project audio ready" : "Audio missing"}
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">
            {audioSource
              ? "Uses the current source or polished preview from this workspace."
              : "Run prep again or reopen a project with an available source file."}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Note count</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">
            {state.notes.length > 0 ? state.notes.length : "—"}
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">
            Transcribed note events become an editable MIDI sketch for the next lane.
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm text-stone-500">Pitch range</p>
          <p className="mt-2 text-lg font-semibold text-stone-950">{noteRange(state.notes)}</p>
          <p className="mt-2 text-sm leading-7 text-stone-700">
            Helpful when deciding whether the sketch maps better to bass, lead, or pads.
          </p>
        </div>
      </div>

      {state.status === "running" ? (
        <div className="mt-4 rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-stone-700">
              Basic Pitch is analyzing the project audio in your browser.
            </p>
            <span className="text-sm font-medium text-stone-950">
              {(state.progress * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-stone-950 transition-[width]"
              style={{ width: `${Math.max(state.progress * 100, 4)}%` }}
            />
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="mt-4 rounded-[1.25rem] bg-amber-100 px-4 py-3 text-sm leading-7 text-amber-900">
          {state.error}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm text-stone-500">Extracted note preview</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {state.notes.slice(0, 12).map((note, index) => (
                <span
                  key={`${note.pitchMidi}:${note.startTimeSeconds}:${index}`}
                  className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm text-emerald-900"
                >
                  {formatPitch(note.pitchMidi)} · {note.startTimeSeconds.toFixed(2)}s
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm text-stone-500">Download and next use</p>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              Pull this sketch into a DAW, a synth lane, or the next editor pass for
              region-aware replacements.
            </p>
            <a
              href={state.midiUrl}
              download={buildDownloadFilename(project)}
              className="mt-4 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
            >
              Download .mid
            </a>
          </div>
        </div>
      ) : null}
    </article>
  );
}
