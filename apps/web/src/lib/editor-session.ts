import type { ProjectDetail } from "@/lib/api";

const BEATS_PER_BAR = 4;
const DEFAULT_BAR_COUNT = 16;
const EDITOR_SESSION_PREFIX = "codex-music-editor-session:";
const MIN_CLIP_BEATS = 1;
const MAX_COMMAND_HISTORY = 12;

export type EditorClip = {
  id: string;
  trackId: string;
  stemId: string;
  label: string;
  color: string;
  clipStartBeat: number;
  clipLengthBeats: number;
  sourceStartBeat: number;
  sourceLengthBeats: number;
  gainDb: number;
  fadeInBeats: number;
  fadeOutBeats: number;
  locked: boolean;
  muted: boolean;
};

export type EditorTrack = {
  id: string;
  stemId: string;
  name: string;
  color: string;
  stemLevelDb: number;
  muted: boolean;
  solo: boolean;
};

export type EditorCommandEntry = {
  id: string;
  createdAt: string;
  source: "command-bar" | "quick-action";
  scope: "clip" | "track" | "timeline";
  status: "applied" | "blocked";
  command: string;
  summary: string;
};

export type EditorSession = {
  projectId: string;
  stemSignature: string;
  tempo: number;
  totalBeats: number;
  zoom: number;
  playheadBeat: number;
  selectedClipId: string | null;
  tracks: EditorTrack[];
  clips: EditorClip[];
  commandHistory: EditorCommandEntry[];
};

export type EditorCommandResult = {
  nextSession: EditorSession;
  status: "applied" | "blocked" | "unmatched";
  summary: string;
};

function buildStemSignature(project: ProjectDetail): string {
  return project.stems.map((stem) => `${stem.id}:${stem.name}:${stem.level_db}`).join("|");
}

function sessionStorageKey(projectId: string): string {
  return `${EDITOR_SESSION_PREFIX}${projectId}`;
}

function createEditorId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function quantizeBeat(value: number): number {
  return Math.round(value * 2) / 2;
}

export function buildInitialEditorSession(project: ProjectDetail): EditorSession {
  const totalBeats = Math.max(DEFAULT_BAR_COUNT * BEATS_PER_BAR, project.stems.length * 8);
  const tracks: EditorTrack[] = project.stems.map((stem) => ({
    id: `track_${stem.id}`,
    stemId: stem.id,
    name: stem.name,
    color: stem.color,
    stemLevelDb: stem.level_db,
    muted: false,
    solo: false,
  }));
  const clips: EditorClip[] = tracks.map((track) => ({
    id: createEditorId("clip"),
    trackId: track.id,
    stemId: track.stemId,
    label: track.name,
    color: track.color,
    clipStartBeat: 0,
    clipLengthBeats: totalBeats,
    sourceStartBeat: 0,
    sourceLengthBeats: totalBeats,
    gainDb: track.stemLevelDb,
    fadeInBeats: 0.5,
    fadeOutBeats: 0.5,
    locked: false,
    muted: false,
  }));

  return {
    projectId: project.id,
    stemSignature: buildStemSignature(project),
    tempo: project.analysis.bpm ?? 120,
    totalBeats,
    zoom: 1,
    playheadBeat: 0,
    selectedClipId: clips[0]?.id ?? null,
    tracks,
    clips,
    commandHistory: [],
  };
}

export function getInitialEditorSession(project: ProjectDetail): EditorSession {
  if (typeof window === "undefined") {
    return buildInitialEditorSession(project);
  }

  const raw = window.localStorage.getItem(sessionStorageKey(project.id));
  if (!raw) {
    return buildInitialEditorSession(project);
  }

  try {
    const parsed = JSON.parse(raw) as EditorSession;
    if (parsed.projectId !== project.id || parsed.stemSignature !== buildStemSignature(project)) {
      return buildInitialEditorSession(project);
    }
    return {
      ...parsed,
      commandHistory: parsed.commandHistory ?? [],
    };
  } catch {
    return buildInitialEditorSession(project);
  }
}

export function persistEditorSession(session: EditorSession): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(sessionStorageKey(session.projectId), JSON.stringify(session));
}

export function createDuplicateClip(session: EditorSession, clip: EditorClip): EditorSession {
  const gapBeats = 1;
  const duplicateStart = clip.clipStartBeat + clip.clipLengthBeats + gapBeats;
  const duplicateEnd = duplicateStart + clip.clipLengthBeats;
  const nextTotalBeats = Math.max(session.totalBeats, duplicateEnd + BEATS_PER_BAR);
  const duplicate: EditorClip = {
    ...clip,
    id: createEditorId("clip"),
    clipStartBeat: duplicateStart,
  };

  return {
    ...session,
    totalBeats: nextTotalBeats,
    selectedClipId: duplicate.id,
    clips: [...session.clips, duplicate],
  };
}

export function splitClipAtPlayhead(session: EditorSession, clip: EditorClip): EditorSession {
  const splitBeat = quantizeBeat(session.playheadBeat);
  const relativeSplit = splitBeat - clip.clipStartBeat;
  if (relativeSplit <= 1 || relativeSplit >= clip.clipLengthBeats - 1) {
    return session;
  }

  const leftClip: EditorClip = {
    ...clip,
    clipLengthBeats: relativeSplit,
    fadeOutBeats: clamp(clip.fadeOutBeats, 0, Math.max(relativeSplit - 0.5, 0)),
  };
  const rightClip: EditorClip = {
    ...clip,
    id: createEditorId("clip"),
    clipStartBeat: splitBeat,
    clipLengthBeats: clip.clipLengthBeats - relativeSplit,
    sourceStartBeat: clip.sourceStartBeat + relativeSplit,
    fadeInBeats: clamp(clip.fadeInBeats, 0, Math.max(clip.clipLengthBeats - relativeSplit - 0.5, 0)),
  };

  return {
    ...session,
    selectedClipId: rightClip.id,
    clips: session.clips.flatMap((existing) =>
      existing.id === clip.id ? [leftClip, rightClip] : [existing],
    ),
  };
}

function selectedClipFromSession(session: EditorSession): EditorClip | null {
  return session.clips.find((clip) => clip.id === session.selectedClipId) ?? null;
}

function selectedTrackFromSession(session: EditorSession, clip: EditorClip | null): EditorTrack | null {
  if (!clip) {
    return null;
  }

  return session.tracks.find((track) => track.id === clip.trackId) ?? null;
}

function beatAmount(command: string, fallback: number): number {
  const match = command.match(/(-?\d+(?:\.\d+)?)\s*(bars?|beats?)/);
  if (!match) {
    return fallback;
  }

  const value = Number(match[1]);
  return match[2].startsWith("bar") ? value * BEATS_PER_BAR : value;
}

function dbAmount(command: string, fallback: number): number {
  const match = command.match(/(-?\d+(?:\.\d+)?)\s*d?b/);
  return match ? Number(match[1]) : fallback;
}

function appendCommandHistory(
  session: EditorSession,
  entry: Omit<EditorCommandEntry, "id" | "createdAt">,
): EditorSession {
  const historyEntry: EditorCommandEntry = {
    ...entry,
    id: createEditorId("command"),
    createdAt: new Date().toISOString(),
  };

  return {
    ...session,
    commandHistory: [historyEntry, ...session.commandHistory].slice(0, MAX_COMMAND_HISTORY),
  };
}

function blockedResult(
  session: EditorSession,
  command: string,
  summary: string,
  scope: EditorCommandEntry["scope"],
  source: EditorCommandEntry["source"],
): EditorCommandResult {
  return {
    nextSession: appendCommandHistory(session, {
      command,
      summary,
      scope,
      source,
      status: "blocked",
    }),
    status: "blocked",
    summary,
  };
}

function appliedResult(
  session: EditorSession,
  command: string,
  summary: string,
  scope: EditorCommandEntry["scope"],
  source: EditorCommandEntry["source"],
): EditorCommandResult {
  return {
    nextSession: appendCommandHistory(session, {
      command,
      summary,
      scope,
      source,
      status: "applied",
    }),
    status: "applied",
    summary,
  };
}

function updateClip(
  session: EditorSession,
  clipId: string,
  updater: (clip: EditorClip) => EditorClip,
): EditorSession {
  return {
    ...session,
    clips: session.clips.map((clip) => (clip.id === clipId ? updater(clip) : clip)),
  };
}

function deleteClip(session: EditorSession, clipId: string): EditorSession {
  const remainingClips = session.clips.filter((clip) => clip.id !== clipId);
  return {
    ...session,
    clips: remainingClips,
    selectedClipId: remainingClips[0]?.id ?? null,
  };
}

export function runEditorCommand(
  session: EditorSession,
  rawCommand: string,
  source: EditorCommandEntry["source"] = "command-bar",
): EditorCommandResult {
  const command = rawCommand.trim().toLowerCase();
  if (!command) {
    return {
      nextSession: session,
      status: "unmatched",
      summary: "Type a command to adjust the selected region.",
    };
  }

  const selectedClip = selectedClipFromSession(session);
  const selectedTrack = selectedTrackFromSession(session, selectedClip);

  if (command.includes("timeline")) {
    if (command.includes("extend")) {
      const amount = Math.max(beatAmount(command, BEATS_PER_BAR), 0.5);
      const nextSession = {
        ...session,
        totalBeats: quantizeBeat(session.totalBeats + amount),
      };
      return appliedResult(
        nextSession,
        rawCommand,
        `Extended the timeline by ${amount / BEATS_PER_BAR} bar${amount === BEATS_PER_BAR ? "" : "s"}.`,
        "timeline",
        source,
      );
    }

    if (command.includes("reset playhead")) {
      const nextSession = {
        ...session,
        playheadBeat: 0,
      };
      return appliedResult(
        nextSession,
        rawCommand,
        "Moved the playhead back to the start of the arrangement.",
        "timeline",
        source,
      );
    }
  }

  if ((command.includes("clear") || command.includes("reset")) && command.includes("solo")) {
    const nextSession = {
      ...session,
      tracks: session.tracks.map((track) => ({ ...track, solo: false })),
    };
    return appliedResult(
      nextSession,
      rawCommand,
      "Cleared every soloed track so the full arrangement is audible again.",
      "track",
      source,
    );
  }

  if (!selectedClip) {
    return blockedResult(
      session,
      rawCommand,
      "Select a clip first so the editor knows which region to change.",
      "clip",
      source,
    );
  }

  if ((command.includes("solo") || command.includes("focus")) && selectedTrack) {
    const nextSession = {
      ...session,
      tracks: session.tracks.map((track) => ({
        ...track,
        solo: track.id === selectedTrack.id,
      })),
    };
    return appliedResult(
      nextSession,
      rawCommand,
      `Focused playback on ${selectedTrack.name}.`,
      "track",
      source,
    );
  }

  if (selectedClip.locked && !command.includes("unlock")) {
    return blockedResult(
      session,
      rawCommand,
      "Unlock the selected clip before changing its arrangement or level.",
      "clip",
      source,
    );
  }

  if (command.includes("split")) {
    const nextSession = splitClipAtPlayhead(session, selectedClip);
    if (nextSession === session) {
      return blockedResult(
        session,
        rawCommand,
        "Move the playhead deeper into the clip before splitting it.",
        "clip",
        source,
      );
    }
    return appliedResult(
      nextSession,
      rawCommand,
      `Split ${selectedClip.label} at ${quantizeBeat(session.playheadBeat)} beats.`,
      "clip",
      source,
    );
  }

  if (command.includes("duplicate")) {
    return appliedResult(
      createDuplicateClip(session, selectedClip),
      rawCommand,
      `Duplicated ${selectedClip.label} and parked the copy after the original.`,
      "clip",
      source,
    );
  }

  if (command.includes("delete") || command.includes("remove")) {
    return appliedResult(
      deleteClip(session, selectedClip.id),
      rawCommand,
      `Removed ${selectedClip.label} from the arrangement.`,
      "clip",
      source,
    );
  }

  if (command.includes("unlock")) {
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, locked: false })),
      rawCommand,
      `Unlocked ${selectedClip.label} for further editing.`,
      "clip",
      source,
    );
  }

  if (command.includes("lock") || command.includes("protect")) {
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, locked: true })),
      rawCommand,
      `Locked ${selectedClip.label} to protect the arrangement.`,
      "clip",
      source,
    );
  }

  if (command.includes("unmute")) {
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, muted: false })),
      rawCommand,
      `Unmuted ${selectedClip.label}.`,
      "clip",
      source,
    );
  }

  if (command.includes("mute")) {
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, muted: true })),
      rawCommand,
      `Muted ${selectedClip.label}.`,
      "clip",
      source,
    );
  }

  if (command.includes("tighten fade")) {
    const targetFade = clamp(Math.min(1, selectedClip.clipLengthBeats - 0.5), 0, selectedClip.clipLengthBeats - 0.5);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        fadeInBeats: Math.max(clip.fadeInBeats, targetFade),
        fadeOutBeats: Math.max(clip.fadeOutBeats, targetFade),
      })),
      rawCommand,
      `Added short protective fades to ${selectedClip.label}.`,
      "clip",
      source,
    );
  }

  if (command.includes("fade in")) {
    const amount = clamp(beatAmount(command, 1), 0, selectedClip.clipLengthBeats - 0.5);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        fadeInBeats: amount,
      })),
      rawCommand,
      `Set the fade-in on ${selectedClip.label} to ${amount} beats.`,
      "clip",
      source,
    );
  }

  if (command.includes("fade out")) {
    const amount = clamp(beatAmount(command, 1), 0, selectedClip.clipLengthBeats - 0.5);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        fadeOutBeats: amount,
      })),
      rawCommand,
      `Set the fade-out on ${selectedClip.label} to ${amount} beats.`,
      "clip",
      source,
    );
  }

  if (
    command.includes("boost") ||
    command.includes("raise gain") ||
    command.includes("turn up") ||
    command.includes("gain +") ||
    command.includes("gain up")
  ) {
    const amount = Math.abs(dbAmount(command, 2));
    const nextGain = clamp(selectedClip.gainDb + amount, -18, 18);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, gainDb: nextGain })),
      rawCommand,
      `Raised ${selectedClip.label} by ${Math.abs(nextGain - selectedClip.gainDb)} dB.`,
      "clip",
      source,
    );
  }

  if (
    command.includes("cut") ||
    command.includes("lower gain") ||
    command.includes("reduce gain") ||
    command.includes("turn down") ||
    command.includes("gain -") ||
    command.includes("gain down")
  ) {
    const amount = Math.abs(dbAmount(command, 2));
    const nextGain = clamp(selectedClip.gainDb - amount, -18, 18);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, gainDb: nextGain })),
      rawCommand,
      `Lowered ${selectedClip.label} by ${Math.abs(nextGain - selectedClip.gainDb)} dB.`,
      "clip",
      source,
    );
  }

  if (command.includes("set gain")) {
    const nextGain = clamp(dbAmount(command, selectedClip.gainDb), -18, 18);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({ ...clip, gainDb: nextGain })),
      rawCommand,
      `Set ${selectedClip.label} to ${nextGain >= 0 ? "+" : ""}${nextGain.toFixed(1)} dB.`,
      "clip",
      source,
    );
  }

  if (command.includes("nudge")) {
    const direction = command.includes("left") ? -1 : 1;
    const amount = Math.max(beatAmount(command, 1), 0.5) * direction;
    const nextStart = clamp(
      quantizeBeat(selectedClip.clipStartBeat + amount),
      0,
      session.totalBeats - selectedClip.clipLengthBeats,
    );
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        clipStartBeat: nextStart,
      })),
      rawCommand,
      `Moved ${selectedClip.label} ${Math.abs(amount)} beats ${direction < 0 ? "earlier" : "later"}.`,
      "clip",
      source,
    );
  }

  if (command.includes("extend")) {
    const amount = Math.max(beatAmount(command, BEATS_PER_BAR), 0.5);
    const maxExtension =
      selectedClip.sourceLengthBeats -
      (selectedClip.sourceStartBeat + selectedClip.clipLengthBeats);
    if (maxExtension <= 0) {
      return blockedResult(
        session,
        rawCommand,
        "This clip is already using all of the available source audio.",
        "clip",
        source,
      );
    }
    const appliedAmount = clamp(amount, 0.5, maxExtension);
    const nextLength = quantizeBeat(selectedClip.clipLengthBeats + appliedAmount);
    const nextSession = updateClip(session, selectedClip.id, (clip) => ({
      ...clip,
      clipLengthBeats: nextLength,
    }));
    return appliedResult(
      {
        ...nextSession,
        totalBeats: Math.max(nextSession.totalBeats, selectedClip.clipStartBeat + nextLength + BEATS_PER_BAR),
      },
      rawCommand,
      `Extended ${selectedClip.label} by ${appliedAmount / BEATS_PER_BAR} bar${appliedAmount === BEATS_PER_BAR ? "" : "s"}.`,
      "clip",
      source,
    );
  }

  if (command.includes("shorten")) {
    const amount = Math.max(beatAmount(command, BEATS_PER_BAR), 0.5);
    const appliedAmount = clamp(amount, 0.5, selectedClip.clipLengthBeats - MIN_CLIP_BEATS);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        clipLengthBeats: quantizeBeat(clip.clipLengthBeats - appliedAmount),
      })),
      rawCommand,
      `Shortened ${selectedClip.label} by ${appliedAmount / BEATS_PER_BAR} bar${appliedAmount === BEATS_PER_BAR ? "" : "s"}.`,
      "clip",
      source,
    );
  }

  if (command.includes("trim start")) {
    const amount = Math.max(beatAmount(command, 1), 0.5);
    const appliedAmount = clamp(amount, 0.5, selectedClip.clipLengthBeats - MIN_CLIP_BEATS);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        clipStartBeat: quantizeBeat(clip.clipStartBeat + appliedAmount),
        clipLengthBeats: quantizeBeat(clip.clipLengthBeats - appliedAmount),
        sourceStartBeat: quantizeBeat(clip.sourceStartBeat + appliedAmount),
      })),
      rawCommand,
      `Trimmed ${appliedAmount} beats from the start of ${selectedClip.label}.`,
      "clip",
      source,
    );
  }

  if (command.includes("trim end")) {
    const amount = Math.max(beatAmount(command, 1), 0.5);
    const appliedAmount = clamp(amount, 0.5, selectedClip.clipLengthBeats - MIN_CLIP_BEATS);
    return appliedResult(
      updateClip(session, selectedClip.id, (clip) => ({
        ...clip,
        clipLengthBeats: quantizeBeat(clip.clipLengthBeats - appliedAmount),
      })),
      rawCommand,
      `Trimmed ${appliedAmount} beats from the end of ${selectedClip.label}.`,
      "clip",
      source,
    );
  }

  return {
    nextSession: session,
    status: "unmatched",
    summary:
      "Try commands like “split at playhead”, “extend by 1 bar”, “boost 2 dB”, or “tighten fades”.",
  };
}
