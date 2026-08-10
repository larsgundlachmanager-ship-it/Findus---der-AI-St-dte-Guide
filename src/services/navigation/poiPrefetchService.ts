/**
 * Zero-latency POI pre-fetch — nur noch Modul-1-POI-Chat (Reboot).
 * Warm: generateModule1ApproachSpeech (seedet Chat + lookPhrase).
 */

import { getAllPois, getPoiWithFacts } from '../../db/database';
import type { Poi } from '../../db/types';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  synthesizePrefetchPcm,
  playPrefetchedPcm,
  isTtsReady,
  waitReady,
} from '../AudioVoiceService';
import { bearingDegrees, distanceMeters, shortestAngleDelta } from './bearing';
import {
  getGpsTrackFixes,
  getTrackMovementBearingDeg,
} from './gpsTrackBuffer';
import { getDeviceHeadingDeg } from './navigationService';
import { getSmoothedSpeedMs } from './transportMode';
import { generateModule1ApproachSpeech } from '../ai/module1PoiChat';

export const PREFETCH_WARM_M = 100;
export const PREFETCH_PLAY_M = 20;
export const PREFETCH_APPROACH_HALF_CONE_DEG = 60;
const MIN_CLOSING_MOVE_M = 4;
const MIN_CLOSING_DELTA_M = 2;

export type PrefetchRadii = { warmM: number; playM: number };

type PrefetchSlot = {
  poiId: number;
  text: string;
  pcm: Float32Array | null;
  sampleRate: number;
  warmedAtMs: number;
  played: boolean;
};

const slots = new Map<number, PrefetchSlot>();
const warming = new Set<number>();
let lastScanAt = 0;
const SCAN_EVERY_MS = 1_500;

export function isClearApproachToPoi(
  userLat: number,
  userLng: number,
  poiLat: number,
  poiLng: number,
  halfConeDeg: number = PREFETCH_APPROACH_HALF_CONE_DEG,
): boolean {
  const toPoi = bearingDegrees(userLat, userLng, poiLat, poiLng);
  const movement = getTrackMovementBearingDeg();
  if (movement != null && Number.isFinite(movement)) {
    if (Math.abs(shortestAngleDelta(movement, toPoi)) <= halfConeDeg) {
      return true;
    }
  }

  const fixes = getGpsTrackFixes();
  if (fixes.length >= 2) {
    const a = fixes[0]!;
    const b = fixes[fixes.length - 1]!;
    const moved = distanceMeters(a.lat, a.lng, b.lat, b.lng);
    if (moved >= MIN_CLOSING_MOVE_M) {
      const dOld = distanceMeters(a.lat, a.lng, poiLat, poiLng);
      const dNew = distanceMeters(b.lat, b.lng, poiLat, poiLng);
      if (dNew < dOld - MIN_CLOSING_DELTA_M) return true;
    }
  }

  return false;
}

async function warmPoi(
  poi: Poi,
  userLat: number,
  userLng: number,
): Promise<void> {
  if (warming.has(poi.id) || slots.has(poi.id)) return;
  warming.add(poi.id);
  try {
    const profile = getCachedUserProfile();
    const withFacts = (await getPoiWithFacts(poi.id)) ?? {
      ...poi,
      facts: [],
    };
    let text = '';
    try {
      const out = await generateModule1ApproachSpeech({
        poi: withFacts,
        profile,
        userLat,
        userLng,
        speedMs: getSmoothedSpeedMs(),
        deviceHeadingDeg: getDeviceHeadingDeg(),
      });
      if (out.skipped) return;
      text = out.text;
    } catch {
      text = '';
    }
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    let pcm: Float32Array | null = null;
    let sampleRate = 24000;
    try {
      if (!isTtsReady()) {
        await waitReady(4_000);
      }
      if (isTtsReady()) {
        const synth = await synthesizePrefetchPcm(text);
        pcm = synth.pcm;
        sampleRate = synth.sampleRate;
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[prefetch] TTS warm failed, text-only buffer:', err);
      }
    }

    slots.set(poi.id, {
      poiId: poi.id,
      text,
      pcm,
      sampleRate,
      warmedAtMs: Date.now(),
      played: false,
    });
    if (__DEV__) {
      console.log(
        `[prefetch] warmed POI #${poi.id} (module1 chat) pcm=${pcm ? 'yes' : 'no'}`,
      );
    }
  } finally {
    warming.delete(poi.id);
  }
}

export async function playPrefetchedPoiIfReady(
  poiId: number,
): Promise<boolean> {
  const slot = slots.get(poiId);
  if (!slot || slot.played) return false;
  slot.played = true;

  if (slot.pcm && slot.pcm.byteLength > 0) {
    try {
      await playPrefetchedPcm(slot.pcm, slot.sampleRate, slot.text);
      // Text behalten bis takePrefetchedTeaserText / clear — Chat ist schon geseedet
      return true;
    } catch (err) {
      console.warn('[prefetch] play failed, fall through to live:', err);
    }
  }

  return false;
}

export function takePrefetchedTeaserText(poiId: number): string | null {
  const slot = slots.get(poiId);
  if (!slot?.text) return null;
  const t = slot.text;
  slots.delete(poiId);
  return t;
}

export function clearPoiPrefetch(poiId?: number): void {
  if (poiId == null) {
    slots.clear();
    return;
  }
  slots.delete(poiId);
}

export async function tickPoiPrefetch(
  lat: number,
  lng: number,
  radii?: PrefetchRadii,
): Promise<void> {
  const now = Date.now();
  if (now - lastScanAt < SCAN_EVERY_MS) return;
  lastScanAt = now;

  const warmM = radii?.warmM ?? PREFETCH_WARM_M;
  const store = useFinnusStore.getState();
  if (store.isListening || store.isGenerating) return;

  try {
    const pois = await getAllPois();
    for (const poi of pois) {
      if (poi.kind !== 'approach' && poi.kind !== 'area' && poi.kind !== 'legacy') {
        continue;
      }
      const d = distanceMeters(lat, lng, poi.lat, poi.lng);
      if (d > warmM || d < 8) continue;
      if (
        !isClearApproachToPoi(lat, lng, poi.lat, poi.lng)
      ) {
        continue;
      }
      void warmPoi(poi, lat, lng);
    }
  } catch {
    /* soft */
  }
}
