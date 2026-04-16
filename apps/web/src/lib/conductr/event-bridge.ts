/**
 * Adapted from nanassound/conductr (Apache-2.0), commit 576bdd6.
 * This keeps the engine->visualizer boundary explicit for the React UI.
 */

import type { ConductrEvent, ConductrPulse } from "./model";

function pulseId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export class ConductrEventBridge {
  private pulses: ConductrPulse[];

  constructor() {
    this.pulses = [];
  }

  onTick(events: ConductrEvent[], timestamp = performance.now()): ConductrPulse[] {
    for (const event of events) {
      this.pulses.push({
        createdAt: timestamp,
        id: pulseId("engine"),
        kind: "engine",
        trackIndex: event.trackIndex,
        velocity: event.velocity,
      });
    }
    return this.snapshot(timestamp);
  }

  onPlayerNote(trackIndex: number, velocity: number, timestamp = performance.now()): ConductrPulse[] {
    this.pulses.push({
      createdAt: timestamp,
      id: pulseId("player"),
      kind: "player",
      trackIndex,
      velocity,
    });
    return this.snapshot(timestamp);
  }

  snapshot(timestamp = performance.now()): ConductrPulse[] {
    this.pulses = this.pulses.filter((pulse) => timestamp - pulse.createdAt <= 1400);
    return [...this.pulses];
  }
}
