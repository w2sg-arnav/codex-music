/**
 * Adapted from nanassound/conductr (Apache-2.0), commit 576bdd6.
 * This keeps the non-blocking musical-director pattern inside codex-music.
 */

import type { PerformanceMetrics } from "@/lib/live-midi/performance-analyzer";
import type { ProjectDetail } from "@/lib/api";
import type { ConductrDirection, ConductrDirectorParams, ConductrTransition } from "./model";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseProjectScale(project: ProjectDetail): string {
  const key = project.analysis.musical_key?.toLowerCase() ?? "";
  if (key.includes("dorian")) {
    return "dorian";
  }
  if (key.includes("mixolydian")) {
    return "mixolydian";
  }
  if (key.includes("pentatonic")) {
    return "pentatonic";
  }
  if (key.includes("blues")) {
    return "blues";
  }
  if (key.includes("minor")) {
    return "minor";
  }
  return "major";
}

function parseProjectRoot(project: ProjectDetail): number | null {
  const raw = project.analysis.musical_key?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const token = raw.split(" ")[0]?.toUpperCase() ?? "";
  const lookup = new Map([
    ["C", 0],
    ["C#", 1],
    ["DB", 1],
    ["D", 2],
    ["D#", 3],
    ["EB", 3],
    ["E", 4],
    ["F", 5],
    ["F#", 6],
    ["GB", 6],
    ["G", 7],
    ["G#", 8],
    ["AB", 8],
    ["A", 9],
    ["A#", 10],
    ["BB", 10],
    ["B", 11],
  ]);
  return lookup.get(token) ?? null;
}

export function defaultConductrParams(project: ProjectDetail): ConductrDirectorParams {
  return {
    drumDensity: 72,
    drumKickHits: 4,
    drumKickRotation: 0,
    drumSnareHits: 4,
    drumSnareRotation: 4,
    drumHatHits: 7,
    drumHatRotation: 0,
    bassTemplate: 2,
    bassMovement: 60,
    bassDensity: 104,
    melodyDensity: 76,
    melodyComplexity: 50,
    melodyRangeHigh: 14,
    melodyPhraseLength: 8,
    harmonyInterval: 2,
    harmonyMode: "above",
    harmonyThin: false,
    swing: 28,
    scale: parseProjectScale(project),
    root: parseProjectRoot(project),
    trackMute: [false, false, false, false],
  };
}

export function conductrFallbackDirection(
  performance: PerformanceMetrics,
  currentParams: ConductrDirectorParams,
): ConductrDirection {
  const params: ConductrDirectorParams = {
    ...currentParams,
    trackMute: [...currentParams.trackMute] as ConductrDirectorParams["trackMute"],
  };
  const velocity = performance.avgVelocity;
  let intent = "Auto-following performer energy";
  let suggestion: string | undefined;

  if (velocity > 0) {
    const targetDensity = clamp(Math.round(velocity * 0.85 + 10), 20, 120);
    params.drumDensity = clamp(
      params.drumDensity + clamp(targetDensity - params.drumDensity, -15, 15),
      20,
      127,
    );
    params.melodyDensity = clamp(
      params.melodyDensity + clamp(targetDensity - params.melodyDensity, -15, 15),
      20,
      127,
    );
    params.bassDensity = clamp(
      params.bassDensity + clamp(targetDensity - params.bassDensity, -12, 12),
      20,
      127,
    );
  }

  if (performance.notesPerSecond > 3) {
    params.bassMovement = clamp(params.bassMovement + 10, 0, 127);
    params.melodyComplexity = clamp(params.melodyComplexity + 8, 0, 127);
    intent = "Matching dense input with wider motion";
  } else if (performance.notesPerSecond > 0 && performance.notesPerSecond < 1) {
    params.bassMovement = clamp(params.bassMovement - 10, 0, 127);
    params.melodyComplexity = clamp(params.melodyComplexity - 8, 0, 127);
    intent = "Pulling the band back around sparse phrasing";
  }

  if (performance.silenceRatio > 0.85) {
    params.trackMute = [false, false, true, true];
    params.drumDensity = clamp(params.drumDensity - 18, 20, 127);
    intent = "Stripping down to the rhythm section";
    suggestion = "Leave space or play a single motif so the band can answer you.";
  } else {
    params.trackMute = [false, false, false, false];
  }

  if (performance.pitchRangeSemitones > 12) {
    params.melodyComplexity = clamp(params.melodyComplexity + 12, 0, 127);
    params.melodyRangeHigh = clamp(params.melodyRangeHigh + 1, 8, 21);
    intent = "Opening the melody to match your range";
  }

  if (performance.velocityTrend > 15) {
    params.drumDensity = clamp(params.drumDensity + 6, 20, 127);
    params.drumHatHits = clamp(params.drumHatHits + 1, 1, 16);
    intent = "Building with your crescendo";
  } else if (performance.velocityTrend < -15) {
    params.drumDensity = clamp(params.drumDensity - 6, 20, 127);
    params.drumHatHits = clamp(params.drumHatHits - 1, 1, 16);
    intent = "Settling with your dynamic drop";
  }

  if (performance.detectedScale && performance.keyConfidence > 0.4) {
    params.scale = performance.detectedScale;
    params.root = performance.detectedRoot;
    intent = `Following your key in ${performance.detectedRootName} ${performance.detectedScale}`;
  }

  return {
    musicalIntent: intent,
    params,
    suggestion,
    transition: "gradual_2bars",
  };
}

function setTrackMute(
  current: ConductrDirectorParams,
  next: [boolean, boolean, boolean, boolean],
): ConductrDirectorParams {
  return {
    ...current,
    trackMute: next,
  };
}

function detectScaleFromCommand(command: string): string | null {
  const candidates = ["major", "minor", "dorian", "mixolydian", "pentatonic", "blues"];
  return candidates.find((candidate) => command.includes(candidate)) ?? null;
}

export function applyConductrVoiceCommand(
  command: string,
  currentParams: ConductrDirectorParams,
  performance: PerformanceMetrics,
): ConductrDirection {
  const lower = command.trim().toLowerCase();
  if (!lower) {
    return conductrFallbackDirection(performance, currentParams);
  }

  let params: ConductrDirectorParams = {
    ...currentParams,
    trackMute: [...currentParams.trackMute] as ConductrDirectorParams["trackMute"],
  };
  let intent = "Applying a verbal direction";
  let suggestion: string | undefined;
  let transition: ConductrTransition = "gradual_2bars";

  if (lower.includes("strip") || lower.includes("breakdown")) {
    params = setTrackMute(params, [false, false, true, true]);
    params.drumDensity = clamp(params.drumDensity - 20, 20, 127);
    intent = "Breaking the arrangement down to rhythm support";
  }

  if (lower.includes("full band") || lower.includes("bring everyone in")) {
    params = setTrackMute(params, [false, false, false, false]);
    params.drumDensity = clamp(params.drumDensity + 10, 20, 127);
    intent = "Opening the full band back up";
  }

  if (lower.includes("only drums")) {
    params = setTrackMute(params, [false, true, true, true]);
    intent = "Parking the arrangement on drums only";
    transition = "immediate";
  }

  if (lower.includes("more drums") || lower.includes("harder drums")) {
    params.drumDensity = clamp(params.drumDensity + 18, 20, 127);
    params.drumKickHits = clamp(params.drumKickHits + 1, 1, 8);
    params.drumHatHits = clamp(params.drumHatHits + 2, 1, 16);
    intent = "Pushing the rhythm section harder";
  }

  if (lower.includes("less drums") || lower.includes("softer drums")) {
    params.drumDensity = clamp(params.drumDensity - 18, 20, 127);
    params.drumHatHits = clamp(params.drumHatHits - 2, 1, 16);
    intent = "Softening the rhythm layer";
  }

  if (lower.includes("more bass")) {
    params.bassMovement = clamp(params.bassMovement + 18, 0, 127);
    params.bassDensity = clamp(params.bassDensity + 12, 20, 127);
    intent = "Letting the bass walk more aggressively";
  }

  if (lower.includes("drop bass") || lower.includes("mute bass")) {
    params.trackMute = [params.trackMute[0], true, params.trackMute[2], params.trackMute[3]];
    intent = "Dropping the bass out of the arrangement";
    transition = "immediate";
  }

  if (lower.includes("melody up") || lower.includes("busier melody")) {
    params.melodyDensity = clamp(params.melodyDensity + 15, 20, 127);
    params.melodyComplexity = clamp(params.melodyComplexity + 15, 0, 127);
    intent = "Opening the melodic lane";
  }

  if (lower.includes("simpler melody") || lower.includes("less melody")) {
    params.melodyDensity = clamp(params.melodyDensity - 15, 20, 127);
    params.melodyComplexity = clamp(params.melodyComplexity - 15, 0, 127);
    intent = "Simplifying the melodic line";
  }

  if (lower.includes("swing") || lower.includes("funky") || lower.includes("shuffle")) {
    params.swing = clamp(params.swing + 18, 0, 127);
    intent = "Leaning the groove into a swung pocket";
  }

  if (lower.includes("straight") || lower.includes("tighter groove")) {
    params.swing = clamp(params.swing - 18, 0, 127);
    intent = "Straightening the groove";
  }

  const detectedScale = detectScaleFromCommand(lower);
  if (detectedScale) {
    params.scale = detectedScale;
    intent = `Shifting the engine to ${detectedScale}`;
  }

  if (lower.includes("build")) {
    params.drumDensity = clamp(params.drumDensity + 10, 20, 127);
    params.melodyComplexity = clamp(params.melodyComplexity + 8, 0, 127);
    params.harmonyThin = false;
    intent = "Building tension into the next section";
    suggestion = "Play a tighter motif while the engine opens up around you.";
  }

  if (lower.includes("jazzy")) {
    params.harmonyInterval = 3;
    params.harmonyMode = "above";
    params.swing = clamp(params.swing + 12, 0, 127);
    intent = "Shifting the harmony into a looser, jazzier pocket";
  }

  return {
    musicalIntent: intent,
    params,
    suggestion,
    transition,
  };
}
