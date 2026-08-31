/**
 * Blickrichtung für die Karten-Nadel.
 *
 * Android: natives TYPE_ROTATION_VECTOR wie Google Maps
 * (Display-Remap + True-North-Deklination). Kein Magnet-Snap.
 * iOS / Fallback: DeviceMotion, sonst Gyro+Mag.
 */

import { Platform } from 'react-native';
import {
  Accelerometer,
  DeviceMotion,
  Gyroscope,
  Magnetometer,
} from 'expo-sensors';
import {
  facingHeadingFromAccelMag,
  fuseGyroMagHeading,
  headingFromDeviceMotionRotation,
  yawRateAroundUpDegPerSec,
} from '../homeMap/homeMapCompass';
import { noteFacingSensorHeading } from './liveDeviceHeading';
import {
  isNativeMapCompassActive,
  startNativeMapCompass,
  stopNativeMapCompass,
} from './nativeMapCompass';

const MOTION_INTERVAL_MS = 16;
const FALLBACK_INTERVAL_MS = 20;

let motionSub: { remove: () => void } | null = null;
let gyroSub: { remove: () => void } | null = null;
let accelSub: { remove: () => void } | null = null;
let magSub: { remove: () => void } | null = null;
let lastAcc: { x: number; y: number; z: number } | null = null;
let lastMag: { x: number; y: number; z: number } | null = null;
let lastGyro: { x: number; y: number; z: number } | null = null;
let lastGyroAt = 0;
let fusedDeg: number | null = null;
let burstSub: { remove: () => void } | null = null;

function noteBurstFromAccel(x: number, y: number, z: number): void {
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (Math.abs(mag - 1) <= 0.32) return;
  try {
    const { noteMotionBurst } = require('../locationService') as {
      noteMotionBurst: () => void;
    };
    noteMotionBurst();
  } catch {
    /* soft */
  }
}

async function startMotionBurstWatch(): Promise<void> {
  if (burstSub) return;
  try {
    const ok = await Accelerometer.isAvailableAsync();
    if (!ok) return;
    Accelerometer.setUpdateInterval(FALLBACK_INTERVAL_MS);
    burstSub = Accelerometer.addListener((m) => {
      noteBurstFromAccel(m.x, m.y, m.z);
    });
  } catch {
    burstSub = null;
  }
}

function stopMotionBurstWatch(): void {
  burstSub?.remove();
  burstSub = null;
}

function pushRotationVector(alphaRad: number, orientationDeg: number): void {
  const deg = headingFromDeviceMotionRotation(alphaRad, orientationDeg);
  if (deg == null) return;
  lastMotionAt = Date.now();
  fusedDeg = deg;
  noteFacingSensorHeading(deg);
}

function pushFallback(): void {
  if (Date.now() - lastMotionAt < 280) return;
  if (!lastAcc || !lastGyro) return;
  const now = Date.now();
  const dt = lastGyroAt > 0 ? (now - lastGyroAt) / 1000 : 0.02;
  lastGyroAt = now;
  const yawRate = yawRateAroundUpDegPerSec(lastGyro, lastAcc);
  if (yawRate == null) return;
  const magDeg =
    lastMag != null ? facingHeadingFromAccelMag(lastAcc, lastMag) : null;
  if (fusedDeg == null) {
    if (magDeg == null) return;
    fusedDeg = magDeg;
  } else {
    fusedDeg = fuseGyroMagHeading(fusedDeg, magDeg, yawRate, dt);
  }
  noteFacingSensorHeading(fusedDeg);
}

async function startFallbackSensors(): Promise<void> {
  if (gyroSub || accelSub) return;
  try {
    const [gyroOk, accOk, magOk] = await Promise.all([
      Gyroscope.isAvailableAsync(),
      Accelerometer.isAvailableAsync(),
      Magnetometer.isAvailableAsync(),
    ]);
    if (!accOk) return;
    Accelerometer.setUpdateInterval(FALLBACK_INTERVAL_MS);
    accelSub = Accelerometer.addListener((m) => {
      lastAcc = { x: m.x, y: m.y, z: m.z };
      noteBurstFromAccel(m.x, m.y, m.z);
      if (gyroOk) pushFallback();
      else if (lastMag) {
        const deg = facingHeadingFromAccelMag(lastAcc, lastMag);
        if (deg != null && Date.now() - lastMotionAt >= 280) {
          fusedDeg = deg;
          noteFacingSensorHeading(deg);
        }
      }
    });
    if (gyroOk) {
      Gyroscope.setUpdateInterval(FALLBACK_INTERVAL_MS);
      gyroSub = Gyroscope.addListener((g) => {
        lastGyro = { x: g.x, y: g.y, z: g.z };
        pushFallback();
      });
    }
    if (magOk) {
      Magnetometer.setUpdateInterval(FALLBACK_INTERVAL_MS);
      magSub = Magnetometer.addListener((m) => {
        lastMag = { x: m.x, y: m.y, z: m.z };
      });
    }
  } catch {
    stopFallbackSensors();
  }
}

function stopFallbackSensors(): void {
  gyroSub?.remove();
  accelSub?.remove();
  magSub?.remove();
  gyroSub = null;
  accelSub = null;
  magSub = null;
  lastAcc = null;
  lastMag = null;
  lastGyro = null;
  lastGyroAt = 0;
}

export async function startFacingHeadingWatch(): Promise<boolean> {
  if (started) return true;
  started = true;
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const native = await startNativeMapCompass();
    if (native) {
      void startMotionBurstWatch();
      return true;
    }
  }
  try {
    DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
    motionSub = DeviceMotion.addListener((m) => {
      const rot = m.rotation;
      if (!rot || !Number.isFinite(rot.alpha)) return;
      const orient =
        typeof m.orientation === 'number' && Number.isFinite(m.orientation)
          ? m.orientation
          : 0;
      pushRotationVector(rot.alpha, orient);
    });
    setTimeout(() => {
      if (isNativeMapCompassActive()) return;
      if (Date.now() - lastMotionAt > 700) {
        void startFallbackSensors();
      }
    }, 800);
    return true;
  } catch {
    stopFacingHeadingWatch();
    await startFallbackSensors();
    return gyroSub != null;
  }
}

export function stopFacingHeadingWatch(): void {
  started = false;
  stopMotionBurstWatch();
  void stopNativeMapCompass();
  motionSub?.remove();
  motionSub = null;
  stopFallbackSensors();
  fusedDeg = null;
  lastMotionAt = 0;
}
