/**
 * Adapted from nanassound/conductr (Apache-2.0), commit 576bdd6.
 * This is a React-friendly TypeScript port of the deterministic pattern engine.
 */

import { detectKey, SCALE_MAP } from "@/lib/live-midi/scale-map";
import type { ConductrDirectorParams, ConductrEvent, ConductrTrackId } from "./model";
import { CONDUCTR_STEPS_PER_BAR, CONDUCTR_TRACKS } from "./model";

const BASS_REST = 0;
const BASS_TIE = 2;
const BASS_ACCENT = 3;

const BASS_TEMPLATES = [
  [3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [3, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2],
  [3, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2],
  [3, 2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [3, 0, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 3, 0, 0, 0],
  [3, 0, 1, 0, 0, 1, 0, 0, 3, 0, 1, 0, 0, 1, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
] as const;

type TrackPattern = ConductrEvent[];

type MelodyState = {
  currentDegree: number;
  direction: 1 | -1;
  prevInterval: number;
  stepsInDirection: number;
};

type BassState = {
  currentDegree: number;
  prevNote: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function trackIdForIndex(trackIndex: number): ConductrTrackId {
  return CONDUCTR_TRACKS[trackIndex] ?? "drums";
}

function emptyEvent(trackIndex: number, step: number): ConductrEvent {
  return {
    note: 0,
    velocity: 0,
    channel: trackIndex === 0 ? 9 : trackIndex - 1,
    step,
    duration: 0,
    flags: 0,
    trackId: trackIdForIndex(trackIndex),
    trackIndex,
  };
}

function cloneTrackPattern(pattern: TrackPattern): TrackPattern {
  return pattern.map((event) => ({ ...event }));
}

function popcount12(mask: number): number {
  let count = 0;
  for (let index = 0; index < 12; index += 1) {
    if (mask & (1 << index)) {
      count += 1;
    }
  }
  return count;
}

function nthSetBit(mask: number, offset: number): number {
  let count = 0;
  for (let index = 0; index < 12; index += 1) {
    if (!(mask & (1 << index))) {
      continue;
    }
    if (count === offset) {
      return index;
    }
    count += 1;
  }
  return 0;
}

function scaleDegreeToMidi(
  root: number,
  scaleMask: number,
  degree: number,
  octave: number,
): number {
  const notesInScale = popcount12(scaleMask);
  if (notesInScale === 0) {
    return clamp(root + octave * 12, 0, 127);
  }

  let octaveOffset = 0;
  let degreeWithin = 0;
  if (degree >= 0) {
    octaveOffset = Math.floor(degree / notesInScale);
    degreeWithin = degree % notesInScale;
  } else {
    octaveOffset = Math.floor((degree - (notesInScale - 1)) / notesInScale);
    degreeWithin = degree - octaveOffset * notesInScale;
  }

  const semitone = nthSetBit(scaleMask, degreeWithin);
  return clamp(root + semitone + (octave + octaveOffset) * 12, 0, 127);
}

function midiToScaleDegree(note: number, root: number, scaleMask: number): number {
  const notesInScale = popcount12(scaleMask);
  if (notesInScale === 0) {
    return 0;
  }

  const difference = note - root;
  const octaves =
    difference >= 0 ? Math.floor(difference / 12) : Math.floor((difference - 11) / 12);
  const pitchClass = difference - octaves * 12;
  let degreeWithin = 0;

  for (let index = 0; index < 12; index += 1) {
    if (index === pitchClass) {
      break;
    }
    if (scaleMask & (1 << index)) {
      degreeWithin += 1;
    }
  }

  return octaves * notesInScale + degreeWithin;
}

function nearestChordTone(degree: number, chordTones: number[]): number {
  if (chordTones.length === 0) {
    return degree;
  }

  let best = degree;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tone of chordTones) {
    const distance = Math.abs(degree - tone);
    if (distance < bestDistance) {
      best = tone;
      bestDistance = distance;
    }
  }
  return best;
}

function euclidean(hits: number, steps: number): number[] {
  let bucket = 0;
  const output: number[] = [];
  for (let index = 0; index < steps; index += 1) {
    bucket += hits;
    if (bucket >= steps) {
      bucket -= steps;
      output.push(1);
    } else {
      output.push(0);
    }
  }
  return output;
}

class DeterministicRng {
  private seedValue: number;

  constructor(seed = 0xdeadbeef) {
    this.seedValue = seed || 0xdeadbeef;
  }

  setSeed(seed: number): void {
    this.seedValue = seed || 0xdeadbeef;
  }

  next(): number {
    let value = this.seedValue >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seedValue = value >>> 0;
    return this.seedValue;
  }

  int(maxExclusive: number): number {
    return this.next() % maxExclusive;
  }
}

export type ConductrTickResult = {
  barCount: number;
  events: ConductrEvent[];
  patterns: Record<ConductrTrackId, TrackPattern>;
  step: number;
};

export class ConductrEngine {
  private readonly bassState: BassState;

  private readonly chordTones: number[];

  private readonly melodyState: MelodyState;

  private readonly patterns: Record<ConductrTrackId, TrackPattern>;

  private readonly playerPitchHistogram: number[];

  private readonly rng: DeterministicRng;

  private barCountValue: number;

  private bpmValue: number;

  private paramsValue: ConductrDirectorParams;

  private recentPlayerNotes: number[];

  private rootValue: number;

  private running: boolean;

  private scaleValue: string;

  private stepValue: number;

  constructor(params: ConductrDirectorParams, seed = 42) {
    this.rng = new DeterministicRng(seed);
    this.paramsValue = {
      ...params,
      trackMute: [...params.trackMute] as ConductrDirectorParams["trackMute"],
    };
    this.rootValue = params.root ?? 0;
    this.scaleValue = params.scale;
    this.bpmValue = 120;
    this.stepValue = CONDUCTR_STEPS_PER_BAR - 1;
    this.barCountValue = 0;
    this.running = false;
    this.chordTones = [0, 2, 4];
    this.recentPlayerNotes = [];
    this.playerPitchHistogram = new Array(12).fill(0);
    this.melodyState = {
      currentDegree: 7,
      direction: 1,
      prevInterval: 0,
      stepsInDirection: 0,
    };
    this.bassState = {
      currentDegree: 0,
      prevNote: 36,
    };
    this.patterns = {
      drums: this.generateDrums(),
      bass: this.generateBass(),
      melody: this.generateMelody(),
      harmony: [],
    };
    this.patterns.harmony = this.generateHarmony(this.patterns.melody);
  }

  get params(): ConductrDirectorParams {
    return {
      ...this.paramsValue,
      trackMute: [...this.paramsValue.trackMute] as ConductrDirectorParams["trackMute"],
    };
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get step(): number {
    return this.stepValue;
  }

  get barCount(): number {
    return this.barCountValue;
  }

  setBpm(bpm: number): void {
    this.bpmValue = clamp(Math.round(bpm), 40, 220);
  }

  setSeed(seed: number): void {
    this.rng.setSeed(seed);
    this.regenerate();
  }

  setScale(root: number | null, scale: string): void {
    this.rootValue = root ?? this.rootValue;
    this.scaleValue = scale in SCALE_MAP ? scale : "major";
    this.regenerate();
  }

  setSwing(amount: number): void {
    this.paramsValue.swing = clamp(Math.round(amount), 0, 127);
  }

  setPosition(step: number, bar: number): void {
    this.stepValue =
      step <= 0 ? CONDUCTR_STEPS_PER_BAR - 1 : clamp(step - 1, 0, CONDUCTR_STEPS_PER_BAR - 1);
    this.barCountValue = Math.max(0, bar);
  }

  setParams(params: ConductrDirectorParams): void {
    this.paramsValue = {
      ...params,
      trackMute: [...params.trackMute] as ConductrDirectorParams["trackMute"],
    };
    if (params.root !== null) {
      this.rootValue = params.root;
    }
    this.scaleValue = params.scale in SCALE_MAP ? params.scale : this.scaleValue;
    this.regenerate();
  }

  feedNote(note: number, velocity: number): void {
    this.recentPlayerNotes.push(note);
    if (this.recentPlayerNotes.length > 24) {
      const removed = this.recentPlayerNotes.shift();
      if (typeof removed === "number") {
        this.playerPitchHistogram[removed % 12] = Math.max(
          0,
          (this.playerPitchHistogram[removed % 12] ?? 0) - 1,
        );
      }
    }
    this.playerPitchHistogram[note % 12] = (this.playerPitchHistogram[note % 12] ?? 0) + 1;

    const detected = detectKey(this.playerPitchHistogram);
    if (detected && detected.confidence > 0.45) {
      this.rootValue = detected.root;
      this.scaleValue = detected.scale;
    } else if (velocity > 0) {
      this.rootValue = note % 12;
    }
    this.regenerate();
  }

  start(): void {
    this.running = true;
    this.stepValue = CONDUCTR_STEPS_PER_BAR - 1;
    this.regenerate();
  }

  stop(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  regenerate(): void {
    this.patterns.drums = this.generateDrums();
    this.patterns.bass = this.generateBass();
    this.patterns.melody = this.generateMelody();
    this.patterns.harmony = this.generateHarmony(this.patterns.melody);
  }

  getTrackPattern(trackId: ConductrTrackId): TrackPattern {
    return cloneTrackPattern(this.patterns[trackId]);
  }

  tick(): ConductrTickResult {
    if (!this.running) {
      return {
        barCount: this.barCountValue,
        events: [],
        patterns: this.snapshotPatterns(),
        step: this.stepValue,
      };
    }

    this.stepValue = (this.stepValue + 1) % CONDUCTR_STEPS_PER_BAR;
    if (this.stepValue === 0) {
      this.barCountValue += 1;
    }

    const events: ConductrEvent[] = [];
    for (const [trackIndex, trackId] of CONDUCTR_TRACKS.entries()) {
      if (this.paramsValue.trackMute[trackIndex]) {
        continue;
      }
      const event = this.patterns[trackId][this.stepValue];
      if (event && event.velocity > 0) {
        events.push({ ...event });
      }
    }

    return {
      barCount: this.barCountValue,
      events,
      patterns: this.snapshotPatterns(),
      step: this.stepValue,
    };
  }

  private snapshotPatterns(): Record<ConductrTrackId, TrackPattern> {
    return {
      drums: cloneTrackPattern(this.patterns.drums),
      bass: cloneTrackPattern(this.patterns.bass),
      melody: cloneTrackPattern(this.patterns.melody),
      harmony: cloneTrackPattern(this.patterns.harmony),
    };
  }

  private scaleMask(): number {
    return SCALE_MAP[this.scaleValue] ?? SCALE_MAP.major;
  }

  private makeEvent(
    trackIndex: number,
    step: number,
    note: number,
    velocity: number,
    duration = 1,
    flags = 0,
  ): ConductrEvent {
    return {
      note,
      velocity,
      channel: trackIndex === 0 ? 9 : trackIndex - 1,
      duration,
      flags,
      step,
      trackId: trackIdForIndex(trackIndex),
      trackIndex,
    };
  }

  private generateDrums(): TrackPattern {
    const steps = CONDUCTR_STEPS_PER_BAR;
    const pattern = Array.from({ length: steps }, (_, step) => emptyEvent(0, step));
    const layers = [
      {
        hits: this.paramsValue.drumKickHits,
        note: 36,
        rotation: this.paramsValue.drumKickRotation,
        velocityBase: 100,
      },
      {
        hits: this.paramsValue.drumSnareHits,
        note: 38,
        rotation: this.paramsValue.drumSnareRotation,
        velocityBase: 90,
      },
      {
        hits: this.paramsValue.drumHatHits,
        note: 42,
        rotation: this.paramsValue.drumHatRotation,
        velocityBase: 70,
      },
    ];

    for (const layer of layers) {
      const rhythm = euclidean(clamp(layer.hits, 1, 16), steps);
      for (let step = 0; step < steps; step += 1) {
        const rhythmIndex = (step + layer.rotation) % steps;
        if (!rhythm[rhythmIndex]) {
          continue;
        }

        let velocity = layer.velocityBase;
        const beatLength = steps / 4;
        if (step === 0) {
          velocity += 20;
        } else if (step === beatLength * 2) {
          velocity += 10;
        } else if (step % beatLength === 0) {
          velocity -= 10;
        } else {
          velocity -= 20;
        }

        velocity += this.rng.int(17) - 8;
        const gate = this.rng.int(128);
        if (gate > this.paramsValue.drumDensity && layer.note !== 36) {
          continue;
        }

        velocity = clamp(velocity, 1, 127);
        if (velocity > pattern[step].velocity) {
          pattern[step] = this.makeEvent(0, step, layer.note, velocity);
        }
      }
    }

    return pattern;
  }

  private generateBass(): TrackPattern {
    const steps = CONDUCTR_STEPS_PER_BAR;
    const pattern = Array.from({ length: steps }, (_, step) => emptyEvent(1, step));
    const template = BASS_TEMPLATES[clamp(this.paramsValue.bassTemplate, 0, 7)] ?? BASS_TEMPLATES[0];
    const scaleMask = this.scaleMask();

    for (let step = 0; step < steps; step += 1) {
      const slot = template[step % 16] ?? BASS_REST;
      if (slot === BASS_REST) {
        continue;
      }

      if (slot === BASS_TIE) {
        if (step > 0 && pattern[step - 1].velocity > 0) {
          pattern[step] = {
            ...pattern[step - 1],
            flags: 0x02,
            step,
          };
        }
        continue;
      }

      const beatLength = steps / 4;
      const strongBeat = beatLength > 0 && step % beatLength === 0;
      let degree = 0;

      if (strongBeat) {
        const roll = this.rng.int(100);
        if (roll < 60) {
          degree = 0;
        } else if (roll < 90) {
          degree = 4;
        } else {
          degree = 2;
        }
      } else if (this.paramsValue.bassMovement < 40) {
        degree = 0;
      } else if (this.paramsValue.bassMovement < 100) {
        degree =
          this.bassState.currentDegree > 0
            ? this.bassState.currentDegree - 1
            : this.bassState.currentDegree < 0
              ? this.bassState.currentDegree + 1
              : 0;
      } else {
        degree = this.bassState.currentDegree + (this.rng.int(2) === 0 ? -1 : 1);
        degree = clamp(degree, -4, 6);
      }

      this.bassState.currentDegree = degree;

      if (this.rng.int(128) > this.paramsValue.bassDensity) {
        continue;
      }

      const note = scaleDegreeToMidi(this.rootValue, scaleMask, degree, 2);
      const velocity = slot === BASS_ACCENT ? 110 : 85;
      pattern[step] = this.makeEvent(
        1,
        step,
        note,
        velocity,
        1,
        slot === BASS_ACCENT ? 0x01 : 0,
      );
      this.bassState.prevNote = note;
    }

    return pattern;
  }

  private generateMelody(): TrackPattern {
    const steps = CONDUCTR_STEPS_PER_BAR;
    const pattern = Array.from({ length: steps }, (_, step) => emptyEvent(2, step));
    const scaleMask = this.scaleMask();

    for (let step = 0; step < steps; step += 1) {
      if (this.rng.int(128) > this.paramsValue.melodyDensity) {
        continue;
      }

      const phraseLength = this.paramsValue.melodyPhraseLength || 8;
      if (step % phraseLength === phraseLength - 1) {
        const snapped = nearestChordTone(this.melodyState.currentDegree, this.chordTones);
        this.melodyState.prevInterval = snapped - this.melodyState.currentDegree;
        this.melodyState.currentDegree = snapped;
        this.melodyState.stepsInDirection = 0;
        pattern[step] = this.makeEvent(
          2,
          step,
          scaleDegreeToMidi(this.rootValue, scaleMask, snapped, 4),
          90,
        );
        continue;
      }

      const directionRoll = this.rng.int(100);
      if (this.melodyState.stepsInDirection >= 3) {
        if (directionRoll < 80) {
          this.melodyState.direction = this.melodyState.direction === 1 ? -1 : 1;
        }
      } else if (this.melodyState.stepsInDirection >= 2) {
        if (directionRoll < 50) {
          this.melodyState.direction = this.melodyState.direction === 1 ? -1 : 1;
        }
      } else if (directionRoll < 20) {
        this.melodyState.direction = this.melodyState.direction === 1 ? -1 : 1;
      }

      let interval = 1;
      const previousInterval = Math.abs(this.melodyState.prevInterval);
      if (previousInterval >= 3) {
        interval = this.rng.int(100) < 70 ? 1 : 2;
      } else {
        const roll = this.rng.int(100);
        if (roll < 50) {
          interval = 1;
        } else if (roll < 75) {
          interval = 2;
        } else if (roll < 90) {
          interval = 3;
        } else {
          interval = clamp(2 + Math.floor(this.paramsValue.melodyComplexity / 42), 2, 5);
        }
      }

      let nextDegree = this.melodyState.currentDegree + interval * this.melodyState.direction;
      if (nextDegree > this.paramsValue.melodyRangeHigh) {
        this.melodyState.direction = -1;
        nextDegree = this.melodyState.currentDegree - interval;
      }
      if (nextDegree < 0) {
        this.melodyState.direction = 1;
        nextDegree = this.melodyState.currentDegree + interval;
      }
      nextDegree = clamp(nextDegree, 0, this.paramsValue.melodyRangeHigh);

      const beatLength = steps / 4;
      if (beatLength > 0 && step % beatLength === 0) {
        const nearest = nearestChordTone(nextDegree, this.chordTones);
        if (Math.abs(nearest - nextDegree) <= 1) {
          nextDegree = nearest;
        }
      }

      const previousDegree = this.melodyState.currentDegree;
      this.melodyState.prevInterval = nextDegree - previousDegree;
      if (nextDegree > previousDegree) {
        this.melodyState.stepsInDirection =
          this.melodyState.direction === 1 ? this.melodyState.stepsInDirection + 1 : 1;
        this.melodyState.direction = 1;
      } else if (nextDegree < previousDegree) {
        this.melodyState.stepsInDirection =
          this.melodyState.direction === -1 ? this.melodyState.stepsInDirection + 1 : 1;
        this.melodyState.direction = -1;
      } else {
        this.melodyState.stepsInDirection = 0;
      }
      this.melodyState.currentDegree = nextDegree;

      const note = scaleDegreeToMidi(this.rootValue, scaleMask, nextDegree, 4);
      const velocity = clamp(80 + this.rng.int(21) - 10, 1, 127);
      pattern[step] = this.makeEvent(2, step, note, velocity);
    }

    return pattern;
  }

  private generateHarmony(melodyPattern: TrackPattern): TrackPattern {
    const steps = CONDUCTR_STEPS_PER_BAR;
    const pattern = Array.from({ length: steps }, (_, step) => emptyEvent(3, step));
    const scaleMask = this.scaleMask();

    for (let step = 0; step < steps; step += 1) {
      const melodyEvent = melodyPattern[step];
      if (!melodyEvent || melodyEvent.velocity === 0) {
        continue;
      }

      const beatLength = steps / 4;
      if (this.paramsValue.harmonyThin && beatLength > 0 && step % beatLength !== 0) {
        continue;
      }

      const melodyDegree = midiToScaleDegree(melodyEvent.note, this.rootValue, scaleMask);
      const harmonyDegree =
        this.paramsValue.harmonyMode === "below"
          ? melodyDegree - this.paramsValue.harmonyInterval
          : melodyDegree + this.paramsValue.harmonyInterval;
      const note = scaleDegreeToMidi(this.rootValue, scaleMask, harmonyDegree, 4);
      const velocity = clamp(melodyEvent.velocity - 10, 1, 127);
      pattern[step] = this.makeEvent(3, step, note, velocity);
    }

    return pattern;
  }
}
