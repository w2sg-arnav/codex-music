export const SCALE_MAP: Record<string, number> = {
  major: 0xab5,
  minor: 0x5ad,
  dorian: 0x5b5,
  mixolydian: 0x56b,
  pentatonic: 0x295,
  blues: 0x69d,
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export type DetectedKey = {
  root: number;
  scale: string;
  confidence: number;
};

export function detectKey(histogram: number[]): DetectedKey | null {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total < 3) {
    return null;
  }

  let bestRoot = 0;
  let bestScale = "major";
  let bestScore = -1;

  for (let root = 0; root < 12; root += 1) {
    for (const [scaleName, mask] of Object.entries(SCALE_MAP)) {
      let inScale = 0;
      let outOfScale = 0;

      for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
        const degree = (pitchClass - root + 12) % 12;
        if (mask & (1 << degree)) {
          inScale += histogram[pitchClass] ?? 0;
        } else {
          outOfScale += histogram[pitchClass] ?? 0;
        }
      }

      const score = (inScale - outOfScale * 2) / total;
      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestScale = scaleName;
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, (bestScore + 1) / 2));
  return {
    root: bestRoot,
    scale: bestScale,
    confidence,
  };
}
