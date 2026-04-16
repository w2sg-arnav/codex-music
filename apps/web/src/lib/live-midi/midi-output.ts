import type { MidiPortOption } from "./midi-input";

type PendingNoteOff = {
  channel: number;
  note: number;
  timeoutId: number;
};

export class LiveMidiOutput {
  private access: MIDIAccess | null;

  private pendingOffs: PendingNoteOff[];

  private port: MIDIOutput | null;

  constructor() {
    this.access = null;
    this.port = null;
    this.pendingOffs = [];
  }

  setAccess(access: MIDIAccess | null): void {
    this.access = access;
  }

  getPorts(): MidiPortOption[] {
    if (!this.access) {
      return [];
    }

    const ports: MidiPortOption[] = [];
    for (const [id, port] of this.access.outputs) {
      ports.push({ id, name: port.name });
    }
    return ports;
  }

  selectPort(id: string): void {
    this.port = this.access?.outputs.get(id) ?? null;
  }

  sendNoteOn(channel: number, note: number, velocity: number): void {
    if (!this.port) {
      return;
    }

    const status = 0x90 | (channel & 0x0f);
    this.port.send([status, note & 0x7f, velocity & 0x7f]);
  }

  sendNoteOff(channel: number, note: number): void {
    if (!this.port) {
      return;
    }

    const status = 0x80 | (channel & 0x0f);
    this.port.send([status, note & 0x7f, 0]);
  }

  scheduleNoteOff(channel: number, note: number, durationMs: number): void {
    const timeoutId = window.setTimeout(() => {
      this.sendNoteOff(channel, note);
      this.pendingOffs = this.pendingOffs.filter((item) => item.timeoutId !== timeoutId);
    }, durationMs);
    this.pendingOffs.push({ channel, note, timeoutId });
  }

  allNotesOff(): void {
    for (const pending of this.pendingOffs) {
      window.clearTimeout(pending.timeoutId);
      this.sendNoteOff(pending.channel, pending.note);
    }
    this.pendingOffs = [];

    if (!this.port) {
      return;
    }

    for (const channel of [0, 1, 2, 4, 9]) {
      this.port.send([0xb0 | channel, 123, 0]);
    }
  }
}
