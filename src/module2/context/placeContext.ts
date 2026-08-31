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
  getLastLiveInventory,
  wantsLocalCityStay,
} from './shortTermContext';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  getWorkingCityName,
  getSoftWorkingCity,
} from '../../services/softWorkingCity';
import {
  computeCityChatScope,
  type CityChatScope,
  type CityChatScopeSource,
} from './cityChatScope';

export type { CityChatScope, CityChatScopeSource };

export type PlaceBiasMode = 'named_city' | 'gps';

export type PlaceContext = {
  /** Anzeigename / Such-Label (kann null sein) */
  city: string | null;
  /** Für Speech: nie leerer String */
  speechPlace: string;
  /** named_city = User meint eine Stadt → City-Center-Bias erlaubt; gps = am Standort suchen */
  biasMode: PlaceBiasMode;
  source: 'explicit' | 'conversation' | 'live_label' | 'gps' | 'profile' | 'soft';
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

/**
 * Aktive Stadt für Thread-Partition / Speech.
 * Soft-/GPS-Arbeitsstadt schlägt Pack-Profil, wenn wir außerhalb des Pack-Fokus sind.
 */
export function resolveActiveCity(): string | null {
  const soft = getWorkingCityName();
  const profile = profileCityName();
  const working = getSoftWorkingCity();
  // Soft-Stadt ohne Pack oder bewusst gesetzt → Grundlage
  if (working?.soft && soft) return soft;
  if (soft && profile && soft.toLowerCase() !== profile.toLowerCase()) {
    // GPS-Ort weicht von Pack ab → Soft gewinnt (Wedel statt Hamburg-Pack)
    return soft;
  }
  return soft || profile;
}

/**
 * Harte Stadt-Chat-Partition für Threads / Regelwerk / M5-Tag.
 * Sticky nur bei Follow-up / Live-Inventar / gleicher Stadt — sonst Active.
 */
export function resolveCityChatScope(
  userText?: string | null,
  liveLocationLabel?: string | null,
): CityChatScope {
  void liveLocationLabel;
  const text = (userText || '').trim();
  const explicit =
    text && !wantsLocalCityStay(text) ? extractCityFromText(text) : null;
  let liveInventoryOpen = false;
  try {
    liveInventoryOpen = Boolean(getLastLiveInventory());
  } catch {
    liveInventoryOpen = false;
  }
  return computeCityChatScope({
    userText: text,
    activeCity: resolveActiveCity(),
    stickyCity: getLastMentionedCity(),
    explicitCity: explicit,
    liveInventoryOpen,
  });
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

  // Lokaler Spazier-/Stay-Intent: Arbeitsstadt (Soft/Pack) vor Chat-Sticky
  if (wantsLocalCityStay(text)) {
    const active = resolveActiveCity();
    if (active) {
      return {
        city: active,
        speechPlace: active,
        biasMode: 'named_city',
        source: getSoftWorkingCity()?.soft ? 'soft' : 'profile',
      };
    }
  }

  const mentioned = getLastMentionedCity();
  if (mentioned) {
    // Produkt/Prospekt: GPS/Active — Sticky-Flugstadt (Athen) nicht übernehmen.
    let skipSticky = false;
    try {
      const {
        isSupermarketOfferQuery,
      } = require('../../services/research/supermarketProspectGates') as {
        isSupermarketOfferQuery: (s: string) => boolean;
      };
      skipSticky = isSupermarketOfferQuery(text);
    } catch {
      skipSticky = false;
    }
    if (!skipSticky) {
      return {
        city: mentioned,
        speechPlace: mentioned,
        biasMode: 'named_city',
        source: 'conversation',
      };
    }
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

  const active = resolveActiveCity();
  if (active) {
    return {
      city: active,
      speechPlace: active,
      biasMode: 'named_city',
      source: getSoftWorkingCity()?.soft ? 'soft' : 'profile',
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
