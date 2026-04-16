/**
 * Adapted from nanassound/conductr (Apache-2.0), commit 576bdd6.
 * This file defines the shared data model for the Conductr-inspired lane.
 */

export const CONDUCTR_TRACKS = ["drums", "bass", "melody", "harmony"] as const;

export const CONDUCTR_STEPS_PER_BAR = 16;

export type ConductrTrackId = (typeof CONDUCTR_TRACKS)[number];

export type ConductrTransition = "immediate" | "gradual_2bars" | "gradual_4bars";

export type ConductrTrackMute = [boolean, boolean, boolean, boolean];

export type ConductrDirectorParams = {
  drumDensity: number;
  drumKickHits: number;
  drumKickRotation: number;
  drumSnareHits: number;
  drumSnareRotation: number;
  drumHatHits: number;
  drumHatRotation: number;
  bassTemplate: number;
  bassMovement: number;
  bassDensity: number;
  melodyDensity: number;
  melodyComplexity: number;
  melodyRangeHigh: number;
  melodyPhraseLength: 4 | 8 | 16;
  harmonyInterval: 2 | 3 | 4 | 5;
  harmonyMode: "above" | "below";
  harmonyThin: boolean;
  swing: number;
  scale: string;
  root: number | null;
  trackMute: ConductrTrackMute;
};

export type ConductrDirection = {
  musicalIntent: string;
  params: ConductrDirectorParams;
  transition: ConductrTransition;
  suggestion?: string;
};

export type ConductrEvent = {
  note: number;
  velocity: number;
  channel: number;
  step: number;
  duration: number;
  flags: number;
  trackId: ConductrTrackId;
  trackIndex: number;
};

export type ConductrPulse = {
  createdAt: number;
  id: string;
  kind: "engine" | "player";
  trackIndex: number;
  velocity: number;
};
