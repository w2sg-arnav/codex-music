export type MidiPortOption = {
  id: string;
  name: string | null;
};

type MidiInputCallbacks = {
  onNoteOn: (note: number, velocity: number, timestamp: number) => void;
  onNoteOff: (note: number, timestamp: number) => void;
  onRawMessage?: (event: MIDIMessageEvent) => void;
  onControlChange?: (
    controller: number,
    value: number,
    timestamp: number,
  ) => void;
};

export class LiveMidiInput {
  private readonly onControlChange?: MidiInputCallbacks["onControlChange"];

  private readonly onNoteOff: MidiInputCallbacks["onNoteOff"];

  private readonly onNoteOn: MidiInputCallbacks["onNoteOn"];

  private readonly onRawMessage?: MidiInputCallbacks["onRawMessage"];

  private access: MIDIAccess | null;

  private enabled: boolean;

  private readonly messageHandler: (event: MIDIMessageEvent) => void;

  private port: MIDIInput | null;

  constructor(callbacks: MidiInputCallbacks) {
    this.onNoteOn = callbacks.onNoteOn;
    this.onNoteOff = callbacks.onNoteOff;
    this.onRawMessage = callbacks.onRawMessage;
    this.onControlChange = callbacks.onControlChange;
    this.access = null;
    this.port = null;
    this.enabled = true;
    this.messageHandler = this.handleMidiMessage.bind(this);
  }

  setAccess(access: MIDIAccess | null): void {
    this.access = access;
  }

  getPorts(): MidiPortOption[] {
    if (!this.access) {
      return [];
    }

    const ports: MidiPortOption[] = [];
    for (const [id, port] of this.access.inputs) {
      ports.push({ id, name: port.name });
    }
    return ports;
  }

  selectPort(id: string): void {
    if (this.port) {
      this.port.onmidimessage = null;
    }

    if (!this.access || !id) {
      this.port = null;
      return;
    }

    this.port = this.access.inputs.get(id) ?? null;
    if (this.port) {
      this.port.onmidimessage = this.messageHandler;
    }
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  dispose(): void {
    if (this.port) {
      this.port.onmidimessage = null;
    }
    this.port = null;
  }

  private handleMidiMessage(event: MIDIMessageEvent): void {
    this.onRawMessage?.(event);

    if (!this.enabled) {
      return;
    }

    const [status = 0, data1 = 0, data2 = 0] = Array.from(event.data ?? new Uint8Array());
    const messageType = status & 0xf0;
    const timestamp = event.timeStamp || performance.now();

    if (messageType === 0x90 && data2 > 0) {
      this.onNoteOn(data1, data2, timestamp);
      return;
    }

    if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
      this.onNoteOff(data1, timestamp);
      return;
    }

    if (messageType === 0xb0) {
      this.onControlChange?.(data1, data2, timestamp);
    }
  }
}
