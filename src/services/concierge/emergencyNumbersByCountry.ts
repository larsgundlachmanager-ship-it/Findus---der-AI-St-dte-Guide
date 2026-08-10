/**
 * Landesabhängige Notrufnummern — SSOT.
 * Land aus Live-GPS (Reverse-Geocode), sonst Profil/Stadt, sonst grobe Lat/Lng-Heuristik.
 */

import * as Location from 'expo-location';
import { getCachedUserProfile } from '../userProfileService';
import { citySearchMeta } from '../../constants/cityCovers';
import { useFinnusStore } from '../../store/useFinnusStore';

export type EmergencyLine = {
  number: string;
  /** Kurzlabel für Button / Bullet (ohne Emoji) */
  label: string;
};

export type CountryEmergencyInfo = {
  /** ISO 3166-1 alpha-2 */
  iso: string;
  countryLabel: string;
  /** Lebensgefahr / einheitlicher Notruf */
  primary: EmergencyLine;
  /** Optional: nicht-akut Ärztlicher Bereitschaft / Nurse Line */
  medicalAdvice?: EmergencyLine;
  /** Optional: Polizei (wenn vom medizinischen Notruf getrennt) */
  police?: EmergencyLine;
};

type CountryEntry = Omit<CountryEmergencyInfo, 'iso'>;

/** Bekannte Länder — restliches Europa → 112 via EU-Fallback. */
const BY_ISO: Record<string, CountryEntry> = {
  DE: {
    countryLabel: 'Deutschland',
    primary: { number: '112', label: 'Notruf' },
    medicalAdvice: { number: '116117', label: 'Ärztl. Bereitschaft' },
    police: { number: '110', label: 'Polizei' },
  },
  AT: {
    countryLabel: 'Österreich',
    primary: { number: '112', label: 'Notruf' },
    medicalAdvice: { number: '1450', label: 'Ärztefunkdienst' },
    police: { number: '133', label: 'Polizei' },
  },
  CH: {
    countryLabel: 'Schweiz',
    primary: { number: '144', label: 'Rettung' },
    police: { number: '117', label: 'Polizei' },
  },
  LI: {
    countryLabel: 'Liechtenstein',
    primary: { number: '112', label: 'Notruf' },
  },
  FR: {
    countryLabel: 'Frankreich',
    primary: { number: '112', label: 'Notruf' },
    medicalAdvice: { number: '15', label: 'SAMU' },
  },
  IT: {
    countryLabel: 'Italien',
    primary: { number: '112', label: 'Notruf' },
  },
  ES: {
    countryLabel: 'Spanien',
    primary: { number: '112', label: 'Notruf' },
  },
  PT: {
    countryLabel: 'Portugal',
    primary: { number: '112', label: 'Notruf' },
  },
  NL: {
    countryLabel: 'Niederlande',
    primary: { number: '112', label: 'Notruf' },
  },
  BE: {
    countryLabel: 'Belgien',
    primary: { number: '112', label: 'Notruf' },
  },
  LU: {
    countryLabel: 'Luxemburg',
    primary: { number: '112', label: 'Notruf' },
  },
  DK: {
    countryLabel: 'Dänemark',
    primary: { number: '112', label: 'Notruf' },
  },
  SE: {
    countryLabel: 'Schweden',
    primary: { number: '112', label: 'Notruf' },
  },
  NO: {
    countryLabel: 'Norwegen',
    primary: { number: '113', label: 'Rettung' },
    police: { number: '112', label: 'Polizei' },
  },
  FI: {
    countryLabel: 'Finnland',
    primary: { number: '112', label: 'Notruf' },
  },
  PL: {
    countryLabel: 'Polen',
    primary: { number: '112', label: 'Notruf' },
  },
  CZ: {
    countryLabel: 'Tschechien',
    primary: { number: '112', label: 'Notruf' },
  },
  SK: {
    countryLabel: 'Slowakei',
    primary: { number: '112', label: 'Notruf' },
  },
  HU: {
    countryLabel: 'Ungarn',
    primary: { number: '112', label: 'Notruf' },
  },
  RO: {
    countryLabel: 'Rumänien',
    primary: { number: '112', label: 'Notruf' },
  },
  BG: {
    countryLabel: 'Bulgarien',
    primary: { number: '112', label: 'Notruf' },
  },
  GR: {
    countryLabel: 'Griechenland',
    primary: { number: '112', label: 'Notruf' },
  },
  HR: {
    countryLabel: 'Kroatien',
    primary: { number: '112', label: 'Notruf' },
  },
  SI: {
    countryLabel: 'Slowenien',
    primary: { number: '112', label: 'Notruf' },
  },
  IE: {
    countryLabel: 'Irland',
    primary: { number: '112', label: 'Notruf' },
  },
  GB: {
    countryLabel: 'Großbritannien',
    primary: { number: '999', label: 'Emergency' },
    medicalAdvice: { number: '111', label: 'NHS 111' },
  },
  UK: {
    countryLabel: 'Großbritannien',
    primary: { number: '999', label: 'Emergency' },
    medicalAdvice: { number: '111', label: 'NHS 111' },
  },
  US: {
    countryLabel: 'USA',
    primary: { number: '911', label: 'Emergency' },
  },
  CA: {
    countryLabel: 'Kanada',
    primary: { number: '911', label: 'Emergency' },
  },
  MX: {
    countryLabel: 'Mexiko',
    primary: { number: '911', label: 'Emergency' },
  },
  AU: {
    countryLabel: 'Australien',
    primary: { number: '000', label: 'Emergency' },
  },
  NZ: {
    countryLabel: 'Neuseeland',
    primary: { number: '111', label: 'Emergency' },
  },
  JP: {
    countryLabel: 'Japan',
    primary: { number: '119', label: 'Feuer/Rettung' },
    police: { number: '110', label: 'Polizei' },
  },
  KR: {
    countryLabel: 'Südkorea',
    primary: { number: '119', label: 'Feuer/Rettung' },
    police: { number: '112', label: 'Polizei' },
  },
  CN: {
    countryLabel: 'China',
    primary: { number: '120', label: 'Rettung' },
    police: { number: '110', label: 'Polizei' },
  },
  IN: {
    countryLabel: 'Indien',
    primary: { number: '112', label: 'Emergency' },
  },
  TR: {
    countryLabel: 'Türkei',
    primary: { number: '112', label: 'Notruf' },
  },
  BR: {
    countryLabel: 'Brasilien',
    primary: { number: '192', label: 'SAMU' },
    police: { number: '190', label: 'Polizei' },
  },
  ZA: {
    countryLabel: 'Südafrika',
    primary: { number: '10177', label: 'Ambulance' },
    police: { number: '10111', label: 'Police' },
  },
  TH: {
    countryLabel: 'Thailand',
    primary: { number: '1669', label: 'Rettung' },
    police: { number: '191', label: 'Polizei' },
  },
  AE: {
    countryLabel: 'VAE',
    primary: { number: '999', label: 'Emergency' },
  },
  SG: {
    countryLabel: 'Singapur',
    primary: { number: '995', label: 'Ambulance/Fire' },
    police: { number: '999', label: 'Police' },
  },
};

/** EU/EEA-Länder ohne eigenen Eintrag → 112 */
const EU_EEA_112 = new Set([
  'AD',
  'AL',
  'BA',
  'CY',
  'EE',
  'IS',
  'LT',
  'LV',
  'MT',
  'ME',
  'MK',
  'RS',
  'XK',
]);

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  deutschland: 'DE',
  germany: 'DE',
  österreich: 'AT',
  osterreich: 'AT',
  austria: 'AT',
  schweiz: 'CH',
  switzerland: 'CH',
  frankreich: 'FR',
  france: 'FR',
  italien: 'IT',
  italy: 'IT',
  spanien: 'ES',
  spain: 'ES',
  portugal: 'PT',
  niederlande: 'NL',
  netherlands: 'NL',
  holland: 'NL',
  belgien: 'BE',
  belgium: 'BE',
  dänemark: 'DK',
  daenemark: 'DK',
  denmark: 'DK',
  schweden: 'SE',
  sweden: 'SE',
  norwegen: 'NO',
  norway: 'NO',
  finnland: 'FI',
  finland: 'FI',
  polen: 'PL',
  poland: 'PL',
  tschechien: 'CZ',
  'czech republic': 'CZ',
  großbritannien: 'GB',
  grossbritannien: 'GB',
  'united kingdom': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  irland: 'IE',
  ireland: 'IE',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  amerika: 'US',
  kanada: 'CA',
  canada: 'CA',
  mexiko: 'MX',
  mexico: 'MX',
  australien: 'AU',
  australia: 'AU',
  neuseeland: 'NZ',
  'new zealand': 'NZ',
  japan: 'JP',
  china: 'CN',
  indien: 'IN',
  india: 'IN',
  türkei: 'TR',
  tuerkei: 'TR',
  turkey: 'TR',
  brasilien: 'BR',
  brazil: 'BR',
  thailand: 'TH',
  griechenland: 'GR',
  greece: 'GR',
  kroatien: 'HR',
  croatia: 'HR',
};

let cachedIso: string | null = null;
let cachedAtMs = 0;
const CACHE_MS = 30 * 60_000;

function normalizeIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iso = raw.trim().toUpperCase();
  if (iso === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(iso)) return iso;
  return null;
}

function isoFromCountryName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .trim();
  return COUNTRY_NAME_TO_ISO[key] ?? null;
}

/** Grobe Offline-Heuristik wenn Reverse-Geocode fehlt. */
function isoFromLatLng(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Grobe Boxen — nur Fallback
  if (lat >= 47.2 && lat <= 55.2 && lng >= 5.8 && lng <= 15.1) return 'DE';
  if (lat >= 46.3 && lat <= 49.1 && lng >= 9.4 && lng <= 17.3) return 'AT';
  if (lat >= 45.7 && lat <= 47.9 && lng >= 5.8 && lng <= 10.6) return 'CH';
  if (lat >= 41.2 && lat <= 51.2 && lng >= -5.5 && lng <= 10.0) return 'FR';
  if (lat >= 36.5 && lat <= 47.2 && lng >= 6.5 && lng <= 18.6) return 'IT';
  if (lat >= 35.9 && lat <= 43.9 && lng >= -9.4 && lng <= 4.5) return 'ES';
  if (lat >= 49.8 && lat <= 59.0 && lng >= -8.3 && lng <= 2.0) return 'GB';
  if (lat >= 24.0 && lat <= 49.5 && lng >= -125.0 && lng <= -66.0) return 'US';
  if (lat >= 41.5 && lat <= 83.2 && lng >= -141.0 && lng <= -52.0) return 'CA';
  if (lat >= -44.0 && lat <= -10.0 && lng >= 112.0 && lng <= 154.0) return 'AU';
  if (lat >= -47.5 && lat <= -34.0 && lng >= 166.0 && lng <= 179.0) return 'NZ';
  if (lat >= 30.0 && lat <= 46.0 && lng >= 128.0 && lng <= 146.0) return 'JP';
  // Mitteleuropa Rest → 112-Land
  if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 40) return 'EU';
  return null;
}

function infoForIso(isoRaw: string): CountryEmergencyInfo {
  const iso = normalizeIso(isoRaw) || 'DE';
  if (BY_ISO[iso]) {
    return { iso, ...BY_ISO[iso]! };
  }
  if (iso === 'EU' || EU_EEA_112.has(iso)) {
    return {
      iso: iso === 'EU' ? 'EU' : iso,
      countryLabel: iso === 'EU' ? 'Europa' : iso,
      primary: { number: '112', label: 'Notruf' },
    };
  }
  // Unbekannt: GSM-Standard 112 (viele Netze routen lokal weiter)
  return {
    iso,
    countryLabel: iso,
    primary: { number: '112', label: 'Notruf' },
  };
}

async function reverseIso(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const p = places[0] as
      | {
          isoCountryCode?: string;
          country?: string;
        }
      | undefined;
    if (!p) return null;
    return (
      normalizeIso(p.isoCountryCode) ||
      isoFromCountryName(p.country ?? null)
    );
  } catch {
    return null;
  }
}

function isoFromProfile(): string | null {
  const profile = getCachedUserProfile();
  const cityId = profile?.cityId?.trim();
  if (cityId) {
    const meta = citySearchMeta(cityId);
    const fromMeta = isoFromCountryName(meta.country ?? null);
    if (fromMeta) return fromMeta;
  }
  // Stadtname enthält oft kein Land — DE-Packs defaulten nicht blind
  return null;
}

/**
 * Aktuelles Land für Notruf (cached).
 */
export async function resolveEmergencyCountryIso(opts?: {
  lat?: number | null;
  lng?: number | null;
}): Promise<string> {
  const now = Date.now();
  if (cachedIso && now - cachedAtMs < CACHE_MS) return cachedIso;

  const store = useFinnusStore.getState();
  const lat =
    opts?.lat != null && Number.isFinite(opts.lat)
      ? opts.lat
      : store.lastGpsLat;
  const lng =
    opts?.lng != null && Number.isFinite(opts.lng)
      ? opts.lng
      : store.lastGpsLng;

  let iso: string | null = null;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    iso = await reverseIso(lat, lng);
    if (!iso) iso = isoFromLatLng(lat, lng);
  }
  if (!iso) iso = isoFromProfile();
  if (!iso) iso = 'DE';

  cachedIso = iso;
  cachedAtMs = now;
  return iso;
}

export async function resolveCountryEmergencyInfo(opts?: {
  lat?: number | null;
  lng?: number | null;
}): Promise<CountryEmergencyInfo> {
  const iso = await resolveEmergencyCountryIso(opts);
  return infoForIso(iso);
}

/** Sync-Lookup wenn ISO schon bekannt (Tests / nach resolve). */
export function emergencyInfoForIso(iso: string): CountryEmergencyInfo {
  return infoForIso(iso);
}

/** Alle bekannten Notruf-Kurzwahlen (Dial-Validierung). */
export function allKnownEmergencyShortNumbers(): Set<string> {
  const out = new Set<string>(['112', '110', '911', '999', '000', '116117']);
  for (const entry of Object.values(BY_ISO)) {
    out.add(entry.primary.number.replace(/\D/g, ''));
    if (entry.medicalAdvice) {
      out.add(entry.medicalAdvice.number.replace(/\D/g, ''));
    }
    if (entry.police) {
      out.add(entry.police.number.replace(/\D/g, ''));
    }
  }
  out.add('1450');
  out.add('111');
  out.add('119');
  out.add('120');
  out.add('15');
  out.add('10111');
  out.add('10177');
  out.add('1669');
  out.add('192');
  out.add('190');
  out.add('995');
  return out;
}

export function isKnownEmergencyShort(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  if (!d) return false;
  if (allKnownEmergencyShortNumbers().has(d)) return true;
  if (/^116\d{3}$/.test(d)) return true;
  return false;
}

/** Für UI-Tests / Cache reset */
export function clearEmergencyCountryCache(): void {
  cachedIso = null;
  cachedAtMs = 0;
}
