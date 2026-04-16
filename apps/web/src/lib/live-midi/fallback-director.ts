import type { PerformanceMetrics } from "./performance-analyzer";

export type DirectorParams = {
  drumDensity: number;
  bassMovement: number;
  melodyDensity: number;
  melodyComplexity: number;
  swing: number;
  scale: string;
  root: number | null;
  trackMute: [boolean, boolean, boolean, boolean];
};

export type DirectorSnapshot = {
  musicalIntent: string;
  params: DirectorParams;
  transition: "immediate" | "gradual_2bars" | "gradual_4bars";
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function fallbackDirector(
  performance: PerformanceMetrics,
  currentParams: DirectorParams,
): DirectorSnapshot {
  const params: DirectorParams = { ...currentParams };
  let intent = "Following performer energy";

  if (performance.avgVelocity > 0) {
    const targetDensity = clamp(Math.round(performance.avgVelocity * 0.85 + 10), 20, 120);
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
  }

  if (performance.notesPerSecond > 3) {
    params.bassMovement = clamp(params.bassMovement + 10, 0, 127);
    params.melodyComplexity = clamp(params.melodyComplexity + 8, 0, 127);
    intent = "Opening up the arrangement to match dense playing";
  } else if (performance.notesPerSecond > 0 && performance.notesPerSecond < 1) {
    params.bassMovement = clamp(params.bassMovement - 10, 0, 127);
    params.melodyComplexity = clamp(params.melodyComplexity - 8, 0, 127);
    intent = "Pulling the band back around sparse phrasing";
  }

  if (performance.silenceRatio > 0.85) {
    params.trackMute = [false, false, true, true];
    params.drumDensity = clamp(params.drumDensity - 18, 20, 127);
    intent = "Stripping back to rhythm support while you leave space";
  } else {
    params.trackMute = [false, false, false, false];
  }

  if (performance.pitchRangeSemitones > 12) {
    params.melodyComplexity = clamp(params.melodyComplexity + 12, 0, 127);
    intent = "Widening melodic response to match your range";
  }

  if (performance.velocityTrend > 15) {
    params.drumDensity = clamp(params.drumDensity + 5, 20, 127);
    intent = "Building with your crescendo";
  } else if (performance.velocityTrend < -15) {
    params.drumDensity = clamp(params.drumDensity - 5, 20, 127);
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
    transition: "gradual_2bars",
  };
}
