type InterpolatableValue = boolean | boolean[] | null | number | string;
type InterpolatableRecord = Record<string, InterpolatableValue>;

function cloneParams<T extends InterpolatableRecord>(params: T): T {
  const next = {} as T;

  for (const key of Object.keys(params) as Array<keyof T>) {
    const value = params[key];
    next[key] = (Array.isArray(value) ? [...value] : value) as T[keyof T];
  }

  return next;
}

export class ParamInterpolator<T extends InterpolatableRecord> {
  private currentValues: T;

  private deltaByKey: Partial<Record<keyof T, number>>;

  private remainingSteps: number;

  private targetValues: T;

  constructor(initial: T) {
    this.currentValues = cloneParams(initial);
    this.targetValues = cloneParams(initial);
    this.deltaByKey = {};
    this.remainingSteps = 0;
  }

  setCurrent(params: T): void {
    this.currentValues = cloneParams(params);
    this.targetValues = cloneParams(params);
    this.deltaByKey = {};
    this.remainingSteps = 0;
  }

  setTarget(params: T, transitionSteps: number): void {
    this.targetValues = cloneParams(params);

    if (transitionSteps <= 0) {
      this.currentValues = cloneParams(params);
      this.deltaByKey = {};
      this.remainingSteps = 0;
      return;
    }

    this.remainingSteps = transitionSteps;
    this.deltaByKey = {};

    for (const key of Object.keys(params) as Array<keyof T>) {
      const from = this.currentValues[key];
      const to = params[key];
      if (typeof from === "number" && typeof to === "number") {
        this.deltaByKey[key] = (to - from) / transitionSteps;
      }
    }
  }

  tick(): T {
    if (this.remainingSteps <= 0) {
      return cloneParams(this.currentValues);
    }

    this.remainingSteps -= 1;

    if (this.remainingSteps === 0) {
      this.currentValues = cloneParams(this.targetValues);
      this.deltaByKey = {};
      return cloneParams(this.currentValues);
    }

    const next = cloneParams(this.currentValues);
    for (const key of Object.keys(this.deltaByKey) as Array<keyof T>) {
      const delta = this.deltaByKey[key];
      const current = next[key];
      if (typeof delta === "number" && typeof current === "number") {
        next[key] = (current + delta) as T[keyof T];
      }
    }
    this.currentValues = next;
    return cloneParams(this.currentValues);
  }

  get current(): T {
    return cloneParams(this.currentValues);
  }

  get isTransitioning(): boolean {
    return this.remainingSteps > 0;
  }
}
