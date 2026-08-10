import { shortestAngleDelta } from './bearing';

/**
 * Adaptive exponential low-pass on compass heading with 0/360 wrap.
 * Base alpha ≈ 0.55: snappy for body turns, still softens handshake jitter.
 * Large deltas temporarily raise alpha so the needle catches up immediately.
 */
export class HeadingLowPass {
  private value: number | null = null;

  constructor(private readonly alpha: number = 0.55) {}

  push(rawDeg: number): number {
    const raw = ((rawDeg % 360) + 360) % 360;
    if (this.value == null || !Number.isFinite(this.value)) {
      this.value = raw;
      return raw;
    }
    const delta = shortestAngleDelta(this.value, raw);
    const abs = Math.abs(delta);
    let a = this.alpha;
    if (abs > 40) {
      a = Math.min(0.9, this.alpha * 1.65);
    } else if (abs > 15) {
      a = Math.min(0.78, this.alpha * 1.35);
    } else if (abs < 2) {
      // Micro jitter — light damp only
      a = this.alpha * 0.75;
    }
    this.value = (this.value + a * delta + 360) % 360;
    return this.value;
  }

  peek(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
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
