/**
 * Arbeits-Stadt unabhängig vom Pack:
 * Speech/Vorschläge folgen dem Ort am GPS.
 * Pack-Geschichten nur im Fokus-Radius der Pack-Stadt (~20 km).
 * Soft-Städte (ohne Datensatz) wachsen aus User-Fragen.
 */

import * as FileSystem from 'expo-file-system';
import { foldCityKey } from './navigation/landmarkAliases';

/**
 * Außerhalb dieses Radius zur Pack-Stadt-Mitte:
 * keine Pack-Stories/Vorschläge mehr — nur noch aktuelle Orts-Stadt (Speech).
 */
export const CITY_FOCUS_RADIUS_KM = 20;

export type SoftWorkingCity = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** true = kein Pack / Soft-Datensatz */
  soft: boolean;
  /** Quelle der letzten Erkennung */
  source: 'pack_focus' | 'catalog' | 'gps_soft' | 'manual';
  updatedAtMs: number;
};

type SoftFact = {
  text: string;
  atMs: number;
  topic?: string;
};

type SoftCityFile = {
  working: SoftWorkingCity | null;
  /** cityKey → gesammelte Fakten aus Fragen */
  journals: Record<string, SoftFact[]>;
};

const STATE_PATH = `${FileSystem.documentDirectory ?? ''}findus-soft-working-city.json`;

let cached: SoftCityFile | null = null;
let memoryWorking: SoftWorkingCity | null = null;
/** Sync: Pack-Inhalt (Modul 1 / Pack-POI-Vorschläge) erlaubt? */
let packSpeechAllowed = true;

function defaultFile(): SoftCityFile {
  return { working: null, journals: {} };
}

async function loadFile(): Promise<SoftCityFile> {
  if (cached) return cached;
  try {
    if (!FileSystem.documentDirectory) {
      cached = defaultFile();
      return cached;
    }
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(STATE_PATH);
      const parsed = JSON.parse(raw) as Partial<SoftCityFile>;
      cached = {
        working:
          parsed.working && typeof parsed.working.name === 'string'
            ? (parsed.working as SoftWorkingCity)
            : null,
        journals:
          parsed.journals && typeof parsed.journals === 'object'
            ? parsed.journals
            : {},
      };
      memoryWorking = cached.working;
      return cached;
    }
  } catch {
    /* soft */
  }
  cached = defaultFile();
  memoryWorking = null;
  return cached;
}

async function saveFile(next: SoftCityFile): Promise<void> {
  cached = next;
  memoryWorking = next.working;
  try {
    if (!FileSystem.documentDirectory) return;
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(next));
  } catch {
    /* soft */
  }
}

export function slugifySoftCityId(name: string): string {
  const key = foldCityKey(name) || name;
  const slug = key
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return slug ? `soft_${slug}` : `soft_unknown`;
}

export function isSoftCityId(id: string | null | undefined): boolean {
  return Boolean(id && /^soft_/i.test(id));
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sync — für Research/Place-Context (nach warmSoftWorkingCity / set). */
export function getSoftWorkingCity(): SoftWorkingCity | null {
  return memoryWorking;
}

export function getWorkingCityName(): string | null {
  const n = memoryWorking?.name?.trim();
  return n || null;
}

export function getWorkingCityId(): string | null {
  return memoryWorking?.id?.trim() || null;
}

/**
 * Modul-1 / Pack-Stories nur wenn GPS noch im Fokus der *selected* Pack-Stadt.
 * Außerhalb → stumm für Auto-Trigger. Gecachte Fremd-Packs bleiben für Q&A nutzbar.
 */
export function isPackSpeechAllowed(): boolean {
  if (memoryWorking?.soft) return false;
  return packSpeechAllowed;
}

export function setPackSpeechAllowed(ok: boolean): void {
  packSpeechAllowed = ok;
}

/**
 * Aktualisiert Speech-Fokus aus GPS vs. Pack-Zentrum.
 * @returns true wenn Pack-Inhalt (Modul 1 / Pack-Vorschläge) erlaubt
 */
export function updatePackSpeechFocus(opts: {
  userLat: number;
  userLng: number;
  packLat?: number | null;
  packLng?: number | null;
}): boolean {
  const { userLat, userLng, packLat, packLng } = opts;
  if (
    typeof packLat !== 'number' ||
    typeof packLng !== 'number' ||
    !Number.isFinite(packLat) ||
    !Number.isFinite(packLng)
  ) {
    // Soft-Stadt / kein Zentrum → kein Pack-Speech
    if (memoryWorking?.soft) {
      packSpeechAllowed = false;
      return false;
    }
    packSpeechAllowed = true;
    return true;
  }
  const km = haversineKm(userLat, userLng, packLat, packLng);
  packSpeechAllowed = km <= CITY_FOCUS_RADIUS_KM && !memoryWorking?.soft;
  return packSpeechAllowed;
}

export async function warmSoftWorkingCity(): Promise<SoftWorkingCity | null> {
  const f = await loadFile();
  memoryWorking = f.working;
  if (memoryWorking?.soft) packSpeechAllowed = false;
  return f.working;
}

export async function setSoftWorkingCity(
  next: Omit<SoftWorkingCity, 'updatedAtMs'> & { updatedAtMs?: number },
): Promise<SoftWorkingCity> {
  const f = await loadFile();
  const working: SoftWorkingCity = {
    id: next.id,
    name: next.name.trim(),
    lat: next.lat,
    lng: next.lng,
    soft: next.soft,
    source: next.source,
    updatedAtMs: next.updatedAtMs ?? Date.now(),
  };
  await saveFile({ ...f, working });
  if (working.soft) {
    packSpeechAllowed = false;
  } else if (working.source === 'pack_focus' || working.source === 'catalog' || working.source === 'manual') {
    packSpeechAllowed = true;
  }
  try {
    const { useRucksackStore } = require('../module2/rucksack/rucksackStore') as {
      useRucksackStore: { getState: () => { setCityHint: (c: string | null) => void } };
    };
    useRucksackStore.getState().setCityHint(working.name);
  } catch {
    /* soft */
  }
  return working;
}

export async function clearSoftWorkingCity(): Promise<void> {
  const f = await loadFile();
  await saveFile({ ...f, working: null });
}

/**
 * Fakten aus User-Fragen / Recherche an Soft-Stadt hängen (max. 40).
 */
export async function noteSoftCityFact(opts: {
  cityName?: string | null;
  cityId?: string | null;
  text: string;
  topic?: string;
}): Promise<void> {
  const text = opts.text.replace(/\s+/g, ' ').trim();
  if (text.length < 12) return;
  const key =
    foldCityKey(opts.cityId?.replace(/^soft_/i, '') || opts.cityName || '') ||
    foldCityKey(memoryWorking?.name || '') ||
    null;
  if (!key) return;
  const f = await loadFile();
  const prev = f.journals[key] ?? [];
  const next = [
    ...prev.filter((x) => x.text !== text),
    { text: text.slice(0, 400), atMs: Date.now(), topic: opts.topic },
  ].slice(-40);
  await saveFile({
    ...f,
    journals: { ...f.journals, [key]: next },
  });
}

export function getSoftCityFactsSync(cityNameOrId?: string | null): SoftFact[] {
  const key =
    foldCityKey(
      (cityNameOrId || memoryWorking?.id || memoryWorking?.name || '').replace(
        /^soft_/i,
        '',
      ),
    ) || null;
  if (!key || !cached?.journals[key]) return [];
  return cached.journals[key] ?? [];
}

export async function getSoftCityFacts(
  cityNameOrId?: string | null,
): Promise<SoftFact[]> {
  await loadFile();
  return getSoftCityFactsSync(cityNameOrId);
}

/**
 * Nominatim: Stadt/Gemeinde am GPS (nicht Straßenname).
 */
export async function reverseGeocodeLocality(
  lat: number,
  lng: number,
): Promise<{ name: string; lat: number; lng: number } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);
    try {
      const u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lng));
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('zoom', '12');
      const res = await fetch(u.toString(), {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        address?: Record<string, string | undefined>;
        lat?: string;
        lon?: string;
      };
      const a = data.address ?? {};
      const name = (
        a.city ||
        a.town ||
        a.village ||
        a.municipality ||
        a.city_district ||
        a.suburb ||
        a.county ||
        ''
      ).trim();
      if (!name || name.length < 2) return null;
      // Keine reinen Straßen / PLZ
      if (/^\d{4,5}$/.test(name) || /strasse|straße|weg\b/i.test(name)) {
        return null;
      }
      return {
        name,
        lat: Number(data.lat) || lat,
        lng: Number(data.lon) || lng,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Expo-Fallback wenn Nominatim fehlt. */
export async function reverseGeocodeLocalityExpo(
  lat: number,
  lng: number,
): Promise<{ name: string; lat: number; lng: number } | null> {
  try {
    const Location = await import('expo-location');
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const p = places[0];
    if (!p) return null;
    const name = (
      p.city ||
      p.subregion ||
      p.district ||
      p.region ||
      ''
    ).trim();
    if (!name || name.length < 2) return null;
    return { name, lat, lng };
  } catch {
    return null;
  }
}

export async function resolveLocalityAt(
  lat: number,
  lng: number,
): Promise<{ name: string; lat: number; lng: number } | null> {
  const n = await reverseGeocodeLocality(lat, lng);
  if (n) return n;
  return reverseGeocodeLocalityExpo(lat, lng);
}
