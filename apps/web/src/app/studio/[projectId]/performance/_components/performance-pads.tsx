"use client";

import { useEffect, useMemo, useState } from "react";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_INDICES = [1, 3, 6, 8, 10];
const KEY_MAP: Record<string, number> = {
  z: 60,
  x: 61,
  c: 62,
  v: 63,
  b: 64,
  n: 65,
  m: 66,
  q: 72,
  w: 73,
  e: 74,
  r: 75,
  t: 76,
  y: 77,
  u: 78,
  i: 79,
  o: 80,
  p: 81,
};

function noteLabel(note: number): string {
  const semitone = note % 12;
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[semitone]}${octave}`;
}

export function PerformancePads({
  onNoteOff,
  onNoteOn,
}: {
  onNoteOff: (note: number) => void;
  onNoteOn: (note: number, velocity: number) => void;
}) {
  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  const keyLabels = useMemo(() => {
    return new Map(Object.entries(KEY_MAP).map(([key, note]) => [note, key.toUpperCase()]));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const note = KEY_MAP[key];
      if (typeof note !== "number" || event.repeat) {
        return;
      }
      setActiveNotes((current) => (current.includes(note) ? current : [...current, note]));
      onNoteOn(note, 100);
    }

    function handleKeyUp(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const note = KEY_MAP[key];
      if (typeof note !== "number") {
        return;
      }
      setActiveNotes((current) => current.filter((value) => value !== note));
      onNoteOff(note);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [onNoteOff, onNoteOn]);

  function renderRow(start: number) {
    return (
      <div className="grid grid-cols-6 gap-3 sm:grid-cols-12">
        {Array.from({ length: 12 }, (_, index) => {
          const note = start + index;
          const isActive = activeNotes.includes(note);
          const isBlack = BLACK_INDICES.includes(note % 12);
          return (
            <button
              key={note}
              type="button"
              onPointerDown={() => {
                setActiveNotes((current) => (current.includes(note) ? current : [...current, note]));
                onNoteOn(note, 100);
              }}
              onPointerUp={() => {
                setActiveNotes((current) => current.filter((value) => value !== note));
                onNoteOff(note);
              }}
              onPointerLeave={() => {
                if (!activeNotes.includes(note)) {
                  return;
                }
                setActiveNotes((current) => current.filter((value) => value !== note));
                onNoteOff(note);
              }}
              className={`rounded-[1rem] border px-3 py-4 text-left transition ${
                isActive
                  ? "border-stone-950 bg-stone-950 text-stone-50"
                  : isBlack
                    ? "border-stone-300 bg-stone-200 text-stone-900"
                    : "border-stone-200 bg-stone-50 text-stone-900"
              }`}
            >
              <p className="text-sm font-medium">{noteLabel(note)}</p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
                {keyLabels.get(note) ?? "Tap"}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <article className="glass-card rounded-[1.5rem] p-6">
      <p className="eyebrow">Input Pads</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
        Play the engine from the browser
      </h2>
      <p className="mt-2 text-sm leading-7 text-stone-700">
        This follows Conductr&apos;s two-octave pad idea with pointer and keyboard input.
      </p>

      <div className="mt-5 space-y-3">
        {renderRow(72)}
        {renderRow(60)}
      </div>
    </article>
  );
}
