import { NOTE_NAMES, detectKey } from "./scale-map";

export type PerformanceMetrics = {
  notesPerSecond: number;
  avgVelocity: number;
  velocityTrend: number;
  pitchRangeSemitones: number;
  lowestNote: number | null;
  highestNote: number | null;
  silenceRatio: number;
  detectedRoot: number | null;
  detectedRootName: string | null;
  detectedScale: string | null;
  keyConfidence: number;
  heldNoteCount: number;
  maxHoldMs: number;
};

type NoteHistoryEvent = {
  note: number;
  velocity: number;
  timestamp: number;
};

type HeldNote = {
  velocity: number;
  timestamp: number;
};

export class PerformanceAnalyzer {
  private readonly windowMs: number;

  private history: NoteHistoryEvent[];

  private heldNotes: Map<number, HeldNote>;

  constructor(windowMs = 8000) {
    this.windowMs = windowMs;
    this.history = [];
    this.heldNotes = new Map();
  }

  recordNote(note: number, velocity: number, timestamp: number): void {
    this.history.push({ note, velocity, timestamp });
    this.heldNotes.set(note, { velocity, timestamp });
    this.trim(timestamp);
  }

  recordNoteOff(note: number): void {
    this.heldNotes.delete(note);
  }

  analyze(now = performance.now()): PerformanceMetrics {
    return this.analyzeWindow(this.windowMs, now);
  }

  analyzeWindow(windowMs: number, now = performance.now()): PerformanceMetrics {
    this.trim(now);
    const cutoff = now - windowMs;
    const windowedHistory = this.history.filter((event) => event.timestamp >= cutoff);

    if (windowedHistory.length === 0) {
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
        heldNoteCount: this.heldNotes.size,
        maxHoldMs: this.maxHoldMs(now),
      };
    }

    const windowSec = windowMs / 1000;
    const notesPerSecond = windowedHistory.length / windowSec;
    const avgVelocity =
      windowedHistory.reduce((sum, event) => sum + event.velocity, 0) / windowedHistory.length;

    let velocityTrend = 0;
    if (windowedHistory.length >= 2) {
      const midpoint = Math.floor(windowedHistory.length / 2);
      const firstHalf = windowedHistory.slice(0, midpoint);
      const secondHalf = windowedHistory.slice(midpoint);
      const firstAverage =
        firstHalf.reduce((sum, event) => sum + event.velocity, 0) / firstHalf.length;
      const secondAverage =
        secondHalf.reduce((sum, event) => sum + event.velocity, 0) / secondHalf.length;
      velocityTrend = secondAverage - firstAverage;
    }

    let lowestNote = 127;
    let highestNote = 0;
    const histogram = new Array(12).fill(0);

    for (const event of windowedHistory) {
      lowestNote = Math.min(lowestNote, event.note);
      highestNote = Math.max(highestNote, event.note);
      histogram[event.note % 12] += 1;
    }

    let coveredMs = 100;
    for (let index = 1; index < windowedHistory.length; index += 1) {
      const gap = windowedHistory[index].timestamp - windowedHistory[index - 1].timestamp;
      if (gap < 500) {
        coveredMs += gap;
      }
    }

    const silenceRatio = Math.max(0, 1 - coveredMs / windowMs);
    const key = detectKey(histogram);

    return {
      notesPerSecond: Math.round(notesPerSecond * 100) / 100,
      avgVelocity: Math.round(avgVelocity),
      velocityTrend: Math.round(velocityTrend),
      pitchRangeSemitones: highestNote - lowestNote,
      lowestNote,
      highestNote,
      silenceRatio: Math.round(silenceRatio * 100) / 100,
      detectedRoot: key?.root ?? null,
      detectedRootName: key ? NOTE_NAMES[key.root] : null,
      detectedScale: key?.scale ?? null,
      keyConfidence: key ? Math.round(key.confidence * 100) / 100 : 0,
      heldNoteCount: this.heldNotes.size,
      maxHoldMs: this.maxHoldMs(now),
    };
  }

  reset(): void {
    this.history = [];
    this.heldNotes.clear();
  }

  private maxHoldMs(now: number): number {
    let max = 0;
    for (const heldNote of this.heldNotes.values()) {
      max = Math.max(max, now - heldNote.timestamp);
    }
    return Math.round(max);
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.history.length > 0 && (this.history[0]?.timestamp ?? 0) < cutoff) {
      this.history.shift();
    }
  }
}
