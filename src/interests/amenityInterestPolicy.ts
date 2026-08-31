/**
 * Directory/amenity_skip vs. Interesse-Venues (Sport/Theater/Kino/Café…).
 * Kein RN-/TriggerPolicy-Import — auch in Smoke-Tests nutzbar.
 */

import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { matchingDimensions } from './interestTaxonomy';

const AMENITY_SKIP_RE =
  /\b(zahnarztpraxis|zahnarzt|zahnmedizin|arztpraxis|hausarzt|\bpraxis\b|gemeinschaftspraxis|klinik|apotheke|apotheker|ärzte|aerzte|\barzt\b|reinigung|textilreinigung|wäscherei|waescherei|dry\s*clean|parkplatz|parkhaus|tiefgarage|tankstelle|autohaus|versicher|notar|steuerberater)\b/i;

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch {
    return String(raw)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
}

function blobOf(poi: Poi): string {
  const tags = parseTags(poi.tags_json);
  return `${poi.category ?? ''} ${poi.name} ${tags.join(' ')}`.toLowerCase();
}

function hasMustHave(poi: Poi): boolean {
  const tags = parseTags(poi.tags_json);
  return (
    tags.includes('must_have') ||
    tags.includes('must-see') ||
    tags.includes('must_see') ||
    tags.includes('landmark')
  );
}

function hasAmenitySkipTier(poi: Poi): boolean {
  const tags = parseTags(poi.tags_json);
  const blob = blobOf(poi);
  if (
    tags.includes('amenity_skip') ||
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('tourist_info') ||
    /\b(tourist.?info|touristen.?information|gepäck|gepaeck|luggage|toilette|öpnv.?halte|bushaltestelle)\b/i.test(
      blob,
    ) ||
    AMENITY_SKIP_RE.test(blob)
  ) {
    return !hasMustHave(poi);
  }
  return false;
}

/** Harte Noise-Amenities — nie proaktiv. */
export function isHardAmenityNoise(poi: Poi): boolean {
  const blob = blobOf(poi);
  if (AMENITY_SKIP_RE.test(blob)) return true;
  if (
    /\b(tourist.?info|touristen.?information|gepäck|gepaeck|luggage|toilette|öpnv.?halte|bushaltestelle|apotheke|praxis|klinik|ärzte|aerzte|\barzt\b)\b/i.test(
      blob,
    )
  ) {
    return true;
  }
  return parseTags(poi.tags_json).includes('tourist_info');
}

/** Orte, die man bewusst besucht — auch als Directory. */
export function isInterestVisitVenue(poi: Poi): boolean {
  if (isHardAmenityNoise(poi)) return false;
  return /\b(sport|tennis|golf|fitness|stadion|theater|kino|cinema|filmtheater|konzert|oper|musical|kabarett|bühne|buehne|museum|galerie|ausstellung|café|cafe|kaffee|coffee|minigolf|beach\s*volley|beachvolleyball|bowling|escape|klettern|bouldern|wasserski|wakeboard|surf|freizeitpark|aktivität|aktivitaet|erlebnis|schwimm|baden)\b/i.test(
    blobOf(poi),
  );
}

/** Apotheke, Arzt, Toilette, Directory ohne Story — touristisch egal. */
export function isNonStoryTouristNoisePoi(poi: Poi): boolean {
  const tags = parseTags(poi.tags_json);
  const packStory =
    tags.includes('story') &&
    !tags.includes('directory') &&
    !tags.includes('amenity_skip') &&
    !tags.includes('tier4');
  if (packStory) return false;
  if (isHardAmenityNoise(poi)) return true;
  if (
    tags.includes('directory') ||
    tags.includes('amenity_skip') ||
    tags.includes('tier4')
  ) {
    return !isInterestVisitVenue(poi);
  }
  return false;
}

/**
 * amenity_skip blockt Modul-1 — außer Interesse-Venue + Pref yes.
 */
export function amenitySkipBlocksProactive(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  if (hasMustHave(poi)) return false;
  if (!hasAmenitySkipTier(poi)) return false;
  if (isHardAmenityNoise(poi)) return true;
  if (!isInterestVisitVenue(poi)) return true;
  if (!profile?.experiencePrefs) return true;

  const tags = parseTags(poi.tags_json);
  const dims = matchingDimensions(tags, poi.category ?? '');
  const prefs = profile.experiencePrefs;
  const legacyKultur = prefs.theater_kultur;

  for (const dim of dims) {
    let v = prefs[dim.prefKey];
    if (
      (v == null || v === 'neutral') &&
      (dim.prefKey === 'theater' ||
        dim.prefKey === 'kino' ||
        dim.prefKey === 'konzert_musical') &&
      (legacyKultur === 'yes' || legacyKultur === 'no')
    ) {
      v = legacyKultur;
    }
    if (v === 'yes') return false;
  }

  const blob = blobOf(poi);
  if (/\b(sport|tennis|golf|fitness|stadion)\b/i.test(blob) && prefs.sport === 'yes') {
    return false;
  }
  if (/\b(café|cafe|kaffee|coffee)\b/i.test(blob) && prefs.cafes === 'yes') {
    return false;
  }
  if (
    /\b(minigolf|beach\s*volley|bowling|escape|klettern|freizeit)\b/i.test(blob) &&
    (prefs.aktivitaeten === 'yes' || prefs.freizeitparks === 'yes')
  ) {
    return false;
  }
  return true;
}
