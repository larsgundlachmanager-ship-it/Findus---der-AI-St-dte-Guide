/**
 * Einmalige Stadt-Begrüßung beim ersten Betreten jeder Stadt.
 * Persistiert „welcome shown for cityId“ — für jede neue Stadt erneut.
 */

import * as FileSystem from 'expo-file-system';
import {
  loadCityCatalog,
  type CityCatalogItem,
} from './cityCatalogService';
import { getCachedUserProfile } from './userProfileService';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from './ttsService';
import { useFinnusStore } from '../store/useFinnusStore';

const STATE_PATH = `${FileSystem.documentDirectory}findus-city-welcome.json`;
const ENTER_RADIUS_KM = 8;
const APPROACH_RADIUS_KM = 18;
const CHECK_INTERVAL_MS = 60_000;

const CITY_WELCOMES: Record<
  string,
  { history: string; highlights: string }
> = {
  wangerooge: {
    history:
      'Wangerooge ist die östlichste der Ostfriesischen Inseln — autofrei, mit eigener Inselbahn vom Anleger ins Dorf.',
    highlights:
      'Westturm, Kurplatz, Strand und der Inselbahnhof sind gute Anker, sobald du oben bist.',
  },
  prisdorf: {
    history:
      'Prisdorf liegt zwischen Pinneberg und der Marsch — Dorfgeschichte, Bahnlinie und ruhige Wege prägen den Ort.',
    highlights:
      'Bahnhof, Ortskern und die typischen Prisdorfer Spots lohnen als Einstieg.',
  },
  pinneberg: {
    history:
      'Pinneberg ist die Kreisstadt am Rand der Elbmarsch — Markt, Kirchspiel und Bahnanschluss nach Hamburg.',
    highlights:
      'Innenstadt, Parks und die Bahnknotenpunkte sind die praktischen Startpunkte.',
  },
};

type WelcomeState = {
  shownCityIds: string[];
};

let cached: WelcomeState | null = null;
let lastCheckAt = 0;
let speaking = false;

function haversineKm(
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

async function loadState(): Promise<WelcomeState> {
  if (cached) return cached;
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (info.exists) {
      const raw = JSON.parse(await FileSystem.readAsStringAsync(STATE_PATH)) as {
        shownCityIds?: unknown;
      };
      cached = {
        shownCityIds: Array.isArray(raw.shownCityIds)
          ? raw.shownCityIds.map(String)
          : [],
      };
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = { shownCityIds: [] };
  return cached;
}

async function persist(state: WelcomeState): Promise<void> {
  cached = state;
  try {
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(state));
  } catch (err) {
    console.warn('[cityWelcome] persist failed:', err);
  }
}

function buildWelcomeSpeech(city: CityCatalogItem): string {
  const pack = CITY_WELCOMES[city.id];
  const sym = city.symbol ?? '';
  const name = city.name;
  if (pack) {
    return (
      `${sym ? `${sym} ` : ''}Willkommen in ${name}! ${pack.history} ${pack.highlights} ` +
      `Ich begleite dich — frag mich einfach, wohin oder was dich interessiert.`
    );
  }
  return (
    `${sym ? `${sym} ` : ''}Willkommen in ${name}! Hier in der Region ${name} zeig ich dir Geschichte, Highlights und was gerade Sinn macht. ` +
    `Sag Bescheid, was du sehen oder erleben willst — ich führ dich hin.`
  );
}

/**
 * Nächste Stadt im Katalog innerhalb APPROACH_RADIUS (GPS), sonst Profil-Stadt.
 */
async function resolveWelcomeCity(
  lat: number,
  lng: number,
): Promise<CityCatalogItem | null> {
  try {
    const catalog = await loadCityCatalog(null);
    let best: CityCatalogItem | null = null;
    let bestKm = Infinity;
    for (const c of catalog) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      const d = haversineKm(lat, lng, c.lat, c.lng);
      if (d < bestKm) {
        bestKm = d;
        best = c;
      }
    }
    if (best && bestKm <= APPROACH_RADIUS_KM) return best;

    const profile = getCachedUserProfile();
    if (profile?.cityId) {
      const fromProfile = catalog.find((c) => c.id === profile.cityId);
      if (
        fromProfile &&
        typeof fromProfile.lat === 'number' &&
        typeof fromProfile.lng === 'number'
      ) {
        const d = haversineKm(lat, lng, fromProfile.lat, fromProfile.lng);
        if (d <= APPROACH_RADIUS_KM) return fromProfile;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Einmalige Begrüßung für jede neue Stadt, die der User betritt.
 */
export async function maybeSpeakFirstCityWelcome(
  lat: number,
  lng: number,
): Promise<boolean> {
  if (speaking) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;

  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return false;
  lastCheckAt = now;

  const city = await resolveWelcomeCity(lat, lng);
  if (!city) return false;

  const distKm =
    typeof city.lat === 'number' && typeof city.lng === 'number'
      ? haversineKm(lat, lng, city.lat, city.lng)
      : Infinity;
  if (distKm > APPROACH_RADIUS_KM) return false;
  if (distKm > ENTER_RADIUS_KM && distKm > 12) return false;

  const state = await loadState();
  if (state.shownCityIds.includes(city.id)) return false;

  speaking = true;
  try {
    const intro = buildWelcomeSpeech(city);
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: intro,
    });
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(intro, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
    await persist({
      shownCityIds: [...state.shownCityIds, city.id],
    });
    return true;
  } catch (err) {
    console.warn('[cityWelcome] speak failed:', err);
    return false;
  } finally {
    speaking = false;
  }
}

/** Für Tests / Reset. */
export async function resetCityWelcomeState(): Promise<void> {
  await persist({ shownCityIds: [] });
}
