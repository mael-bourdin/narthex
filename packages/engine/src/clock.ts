/**
 * Time, injectable. The real game runs on the wall clock; the simulation and the tests
 * run on a clock that can be sped up or jumped forward, so a week of company life
 * can be watched in a minute.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class SimulatedClock implements Clock {
  private offset = 0;
  private readonly startReal = Date.now();

  private readonly start: number;
  private readonly speed: number;

  /** @param speed simulated milliseconds per real millisecond (60 = one minute per second). */
  constructor(start: number = Date.now(), speed = 0) {
    this.start = start;
    this.speed = speed;
  }

  now(): number {
    return this.start + (Date.now() - this.startReal) * this.speed + this.offset;
  }

  advance(ms: number): void {
    this.offset += ms;
  }
}
