/**
 * Modul-2 Ortskontext — unabhängig vom ausgewählten City-Pack.
 *
 * Priorität:
 * 1) Stadt/Ort explizit in der Frage
 * 2) Zuletzt im Gespräch genannte Stadt (Nachbarstadt-Sidequest)
 * 3) Live-Label (POI/Ort aus GPS-Nähe) — nur als Name, Suche bleibt GPS-zentriert
 * 4) rein GPS („hier in der Nähe“)
 *
 * Modul 1 braucht den Städtedatensatz; Modul 2 nicht.
 */

import {
  extractCityFromText,
  getLastMentionedCity,
  wantsLocalCityStay,
} from './shortTermContext';
import { getCachedUserProfile } from '../../services/userProfileService';

export type PlaceBiasMode = 'named_city' | 'gps';

export type PlaceContext = {
  /** Anzeigename / Such-Label (kann null sein) */
  city: string | null;
  /** Für Speech: nie leerer String */
  speechPlace: string;
  /** named_city = User meint eine Stadt → City-Center-Bias erlaubt; gps = am Standort suchen */
  biasMode: PlaceBiasMode;
  source: 'explicit' | 'conversation' | 'live_label' | 'gps' | 'profile';
};

function profileCityName(): string | null {
  try {
    const p = getCachedUserProfile();
    const name = (p?.cityName || p?.cityId || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function resolvePlaceContext(
  text: string,
  liveLocationLabel?: string | null,
): PlaceContext {
  const explicit = extractCityFromText(text);
  if (explicit) {
    return {
      city: explicit,
      speechPlace: explicit,
      biasMode: 'named_city',
      source: 'explicit',
    };
  }

  // Lokaler Spazier-/Stay-Intent: Profilstadt schlägt Chat-Sticky (z. B. Hamburg vom Ostsee-Thread)
  if (wantsLocalCityStay(text)) {
    const profile = profileCityName();
    if (profile) {
      return {
        city: profile,
        speechPlace: profile,
        biasMode: 'named_city',
        source: 'profile',
      };
    }
  }

  const mentioned = getLastMentionedCity();
  if (mentioned) {
    return {
      city: mentioned,
      speechPlace: mentioned,
      biasMode: 'named_city',
      source: 'conversation',
    };
  }

  const live = liveLocationLabel?.trim() || null;
  if (live) {
    const cityInLive = extractCityFromText(live);
    return {
      city: cityInLive ?? live,
      speechPlace: live,
      biasMode: 'gps',
      source: 'live_label',
    };
  }

  const profile = profileCityName();
  if (profile) {
    return {
      city: profile,
      speechPlace: profile,
      biasMode: 'named_city',
      source: 'profile',
    };
  }

  return {
    city: null,
    speechPlace: 'hier in der Nähe',
    biasMode: 'gps',
    source: 'gps',
  };
}

/** Kompatibel für Agents: Stadtname oder „hier in der Nähe“ — nie Pack-Default. */
export function resolveWorkingPlace(
  text: string,
  liveLocationLabel?: string | null,
  taskCity?: string | null,
): PlaceContext {
  // Explizite Stadt in der User-Frage schlägt immer Router-/Task-City
  // (sonst: „Hotel in Hamburg“ landet fälschlich am GPS/Home).
  const explicitInText = extractCityFromText(text);
  if (explicitInText && !wantsLocalCityStay(text)) {
    return {
      city: explicitInText,
      speechPlace: explicitInText,
      biasMode: 'named_city',
      source: 'explicit',
    };
  }
  // Lokaler Stay/Spaziergang: Profil vor Task-/Chat-Sticky
  if (wantsLocalCityStay(text)) {
    return resolvePlaceContext(text, liveLocationLabel);
  }
  if (explicitInText) {
    return {
      city: explicitInText,
      speechPlace: explicitInText,
      biasMode: 'named_city',
      source: 'explicit',
    };
  }
  if (taskCity?.trim()) {
    const t = taskCity.trim();
    const fromTask = extractCityFromText(t) ?? t;
    if (/hier\s+in\s+der\s+nähe/i.test(fromTask) || /^\d+\.\d+/.test(fromTask)) {
      return resolvePlaceContext(text, liveLocationLabel);
    }
    return {
      city: fromTask,
      speechPlace: fromTask,
      biasMode: 'named_city',
      source: 'conversation',
    };
  }
  return resolvePlaceContext(text, liveLocationLabel);
}
