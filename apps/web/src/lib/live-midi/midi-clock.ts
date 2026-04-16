const BPM_WINDOW_SIZE = 24;
const CLOCK_TIMEOUT_MS = 2000;
const TICKS_PER_STEP = 6;

type MidiClockCallbacks = {
  onBpmChange: (bpm: number) => void;
  onClockDetected: () => void;
  onClockLost: () => void;
  onContinue: () => void;
  onPositionChange: (step: number, bar: number) => void;
  onStart: () => void;
  onStep: () => void;
  onStop: () => void;
};

export class MidiClock {
  private readonly onBpmChange: MidiClockCallbacks["onBpmChange"];

  private readonly onClockDetected: MidiClockCallbacks["onClockDetected"];

  private readonly onClockLost: MidiClockCallbacks["onClockLost"];

  private readonly onContinue: MidiClockCallbacks["onContinue"];

  private readonly onPositionChange: MidiClockCallbacks["onPositionChange"];

  private readonly onStart: MidiClockCallbacks["onStart"];

  private readonly onStep: MidiClockCallbacks["onStep"];

  private readonly onStop: MidiClockCallbacks["onStop"];

  private bpmValue: number;

  private clockActive: boolean;

  private enabled: boolean;

  private tickCount: number;

  private tickTimes: number[];

  private timeoutId: number | null;

  constructor(callbacks: MidiClockCallbacks) {
    this.onStep = callbacks.onStep;
    this.onStart = callbacks.onStart;
    this.onStop = callbacks.onStop;
    this.onContinue = callbacks.onContinue;
    this.onBpmChange = callbacks.onBpmChange;
    this.onPositionChange = callbacks.onPositionChange;
    this.onClockDetected = callbacks.onClockDetected;
    this.onClockLost = callbacks.onClockLost;
    this.enabled = false;
    this.clockActive = false;
    this.tickCount = 0;
    this.bpmValue = 0;
    this.tickTimes = [];
    this.timeoutId = null;
  }

  handleMessage(event: MIDIMessageEvent): void {
    if (!this.enabled) {
      return;
    }

    const status = event.data?.[0] ?? 0;
    switch (status) {
      case 0xf8:
        this.handleClockTick(event.timeStamp || performance.now());
        break;
      case 0xfa:
        this.tickCount = 0;
        this.onStart();
        break;
      case 0xfb:
        this.onContinue();
        break;
      case 0xfc:
        this.onStop();
        break;
      case 0xf2:
        this.handleSongPosition(event.data?.[1] ?? 0, event.data?.[2] ?? 0);
        break;
      default:
        break;
    }
  }

  enable(): void {
    this.enabled = true;
    this.resetTimeout();
  }

  disable(): void {
    this.enabled = false;
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.clockActive) {
      this.clockActive = false;
      this.tickTimes = [];
      this.bpmValue = 0;
    }
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get isClockActive(): boolean {
    return this.clockActive;
  }

  private handleClockTick(timestamp: number): void {
    if (!this.clockActive) {
      this.clockActive = true;
      this.onClockDetected();
    }

    this.resetTimeout();
    this.tickTimes.push(timestamp);
    if (this.tickTimes.length > BPM_WINDOW_SIZE) {
      this.tickTimes.shift();
    }

    if (this.tickTimes.length >= 2) {
      const first = this.tickTimes[0] ?? timestamp;
      const last = this.tickTimes[this.tickTimes.length - 1] ?? timestamp;
      const span = last - first;
      const averageTickMs = span / (this.tickTimes.length - 1);
      const nextBpm = Math.round(60000 / (averageTickMs * 24));
      if (nextBpm !== this.bpmValue && nextBpm > 20 && nextBpm < 400) {
        this.bpmValue = nextBpm;
        this.onBpmChange(nextBpm);
      }
    }

    this.tickCount += 1;
    if (this.tickCount >= TICKS_PER_STEP) {
      this.tickCount = 0;
      this.onStep();
    }
  }

  private handleSongPosition(lsb: number, msb: number): void {
    const midiBeats = (msb << 7) | lsb;
    const stepsPerBar = 16;
    const step = midiBeats % stepsPerBar;
    const bar = Math.floor(midiBeats / stepsPerBar);
    this.tickCount = 0;
    this.onPositionChange(step, bar);
  }

  private resetTimeout(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(() => {
      if (!this.clockActive) {
        return;
      }
      this.clockActive = false;
      this.bpmValue = 0;
      this.tickTimes = [];
      this.onClockLost();
    }, CLOCK_TIMEOUT_MS);
  }
}
