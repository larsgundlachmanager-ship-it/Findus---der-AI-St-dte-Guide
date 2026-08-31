import { shortestAngleDelta } from './bearing';

/**
 * Rate-aware heading filter (0/360 wrap).
 *
 * Absolute sample-to-sample deltas alone are a bad proxy: magnetometer noise
 * often jumps 10–20° left/right while standing. At 25–60 Hz that looks like
 * hundreds of °/s and used to snap the needle L↔R while real turns still felt
 * sticky from stacked EMAs.
 *
 * Rules:
 * - Same-sign streak (consistent turn) → raise alpha / catch up
 * - Sign flips (L↔R chatter) → hold / heavy damp
 * - Single huge jump (≥40°) → snap (real body turn)
 * - Standing micro-noise → deadband hold
 */
export class HeadingLowPass {
  private value: number | null = null;
  private lastRaw: number | null = null;
  private lastAtMs: number | null = null;
  private lastDeltaSign = 0;
  private flipCount = 0;
  private sameSignStreak = 0;
  private alpha: number;

  constructor(alpha: number = 0.32) {
    this.alpha = alpha;
  }

  /** Change blend factor without resetting the filtered value. */
  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }

  push(rawDeg: number, nowMs: number = Date.now()): number {
    const raw = ((rawDeg % 360) + 360) % 360;
    if (this.value == null || !Number.isFinite(this.value)) {
      this.value = raw;
      this.lastRaw = raw;
      this.lastAtMs = nowMs;
      this.lastDeltaSign = 0;
      this.flipCount = 0;
      this.sameSignStreak = 0;
      return raw;
    }

    const prevAt = this.lastAtMs ?? nowMs;
    // Floor dt so a 12° mag spike at 40 Hz isn't treated as 300°/s.
    const dtMs = Math.max(50, Math.min(250, nowMs - prevAt || 50));
    const dt = dtMs / 1000;
    const delta = shortestAngleDelta(this.value, raw);
    const abs = Math.abs(delta);
    const rate = abs / dt;

    const rawDelta =
      this.lastRaw != null ? shortestAngleDelta(this.lastRaw, raw) : delta;
    const sign = Math.sign(rawDelta);
    if (sign !== 0) {
      if (this.lastDeltaSign !== 0 && sign !== this.lastDeltaSign) {
        this.flipCount = Math.min(8, this.flipCount + 1);
        this.sameSignStreak = 1;
      } else {
        this.sameSignStreak =
          sign === this.lastDeltaSign ? this.sameSignStreak + 1 : 1;
        if (sign === this.lastDeltaSign) {
          this.flipCount = Math.max(0, this.flipCount - 1);
        }
      }
      this.lastDeltaSign = sign;
    }

    // Micro noise while not turning — hold needle still
    if (abs < 3.2 && rate < 22) {
      this.lastRaw = raw;
      this.lastAtMs = nowMs;
      return this.value;
    }

    // Oscillating chatter: ignore L↔R spikes
    if (this.flipCount >= 2 && abs < 22) {
      this.lastRaw = raw;
      this.lastAtMs = nowMs;
      return this.value;
    }

    const confirmed = this.sameSignStreak >= 2;
    let a: number;

    // One-sample body turn (e.g. 90°) — always catch up
    if (abs >= 40) {
      a = 0.94;
    } else if (confirmed && (rate >= 55 || abs >= 18)) {
      a = 0.88;
    } else if (confirmed && (rate >= 28 || abs >= 10)) {
      a = 0.62;
    } else if (confirmed && rate >= 14) {
      a = Math.max(this.alpha, 0.4);
    } else if (this.flipCount >= 1 && abs < 20) {
      // Likely noise, not a turn yet
      a = Math.min(this.alpha, 0.12);
    } else {
      // Unconfirmed small/medium move — stay calm
      a = Math.min(this.alpha, 0.2);
    }

    this.value = (this.value + a * delta + 360) % 360;
    this.lastRaw = raw;
    this.lastAtMs = nowMs;
    return this.value;
  }

  peek(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.lastRaw = null;
    this.lastAtMs = null;
    this.lastDeltaSign = 0;
    this.flipCount = 0;
    this.sameSignStreak = 0;
  }
}

/**
 * Soften GPS jitter near waypoints / destination.
 * Rejects single-sample jumps (urban canyon) and blends small moves.
 */
export class PositionLowPass {
  private lat: number | null = null;
  private lng: number | null = null;

  constructor(
    /** Blend factor for accepted updates (lower = smoother). */
    private readonly alpha: number = 0.35,
    /** Ignore a single jump larger than this (meters). */
    private readonly rejectJumpM: number = 28,
  ) {}

  push(
    lat: number,
    lng: number,
    distanceMetersFn: (
      aLat: number,
      aLng: number,
      bLat: number,
      bLng: number,
    ) => number,
  ): { lat: number; lng: number } {
    if (this.lat == null || this.lng == null) {
      this.lat = lat;
      this.lng = lng;
      return { lat, lng };
    }

    const jump = distanceMetersFn(this.lat, this.lng, lat, lng);
    if (jump > this.rejectJumpM) {
      // Keep last stable fix — one-frame canyon spike
      return { lat: this.lat, lng: this.lng };
    }

    this.lat = this.lat + this.alpha * (lat - this.lat);
    this.lng = this.lng + this.alpha * (lng - this.lng);
    return { lat: this.lat, lng: this.lng };
  }

  reset(): void {
    this.lat = null;
    this.lng = null;
  }
}
