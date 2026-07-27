/**
 * Erkennt, wenn der Nutzer näher an einer anderen Stadt ist als an der
 * aktuell gewählten — und bietet einen Wechsel mit kurzer Begrüßung an.
 */

import { Alert } from 'react-native';
import {
  loadCityCatalog,
  installCityPack,
  type CityCatalogItem,
} from './cityCatalogService';
import { getCachedUserProfile } from './userProfileService';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from './ttsService';
import { useFinnusStore } from '../store/useFinnusStore';

const SWITCH_GAP_KM = 5;
const CHECK_INTERVAL_MS = 3 * 60_000;
const MIN_MOVE_KM = 0.5;

const CITY_INTROS: Record<string, string> = {
  wangerooge:
    'Willkommen auf Wangerooge! Ich begleite dich durch die autofreie Nordseeinsel — von der Inselbahn bis zum Westturm.',
  prisdorf:
    'Willkommen in Prisdorf! Ich zeige dir das Dorf zwischen Pinneberg und der Bahnlinie nach Hamburg.',
  pinneberg:
    'Willkommen in Pinneberg! Ich kenne die Stadt am Rand der Marsch — lass uns loslegen.',
};

export type CitySwitchResult = {
  cityId: string;
  cityName: string;
};

export type CityProximityHandlers = {
  onCitySwitched: (result: CitySwitchResult) => void | Promise<void>;
};

let handlers: CityProximityHandlers | null = null;
let catalogCache: CityCatalogItem[] | null = null;
let catalogFetchedAt = 0;
let lastCheckAt = 0;
let lastCheckLat: number | null = null;
let lastCheckLng: number | null = null;
let promptOpen = false;
let lastDismissedCityId: string | null = null;
let lastDismissedAt = 0;

const CATALOG_TTL_MS = 10 * 60_000;
const DISMISS_COOLDOWN_MS = 30 * 60_000;

export function registerCityProximityHandlers(h: CityProximityHandlers | null): void {
  handlers = h;
}

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

async function getCatalog(): Promise<CityCatalogItem[]> {
  const now = Date.now();
  if (catalogCache && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const catalog = await loadCityCatalog(null);
  catalogCache = catalog;
  catalogFetchedAt = now;
  return catalog;
}

function cityIntro(city: CityCatalogItem): string {
  const custom = CITY_INTROS[city.id];
  if (custom) return custom;
  const sym = city.symbol ?? '📍';
  return `${sym} Willkommen in ${city.name}! Ich bin Findus und begleite dich durch die Stadt.`;
}

async function greetNewCity(city: CityCatalogItem): Promise<void> {
  const intro = cityIntro(city);
  useFinnusStore.getState().addChatMessage({ role: 'assistant', content: intro });
  const voice = await getVoiceSettingsForTour();
  await speakAssistantText(intro, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });
}

async function applyCitySwitch(city: CityCatalogItem): Promise<void> {
  await installCityPack(city.id);
  const result: CitySwitchResult = {
    cityId: city.id,
    cityName: city.name,
  };
  await handlers?.onCitySwitched(result);
  await greetNewCity(city);
}

function shouldThrottle(lat: number, lng: number): boolean {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) {
    if (lastCheckLat != null && lastCheckLng != null) {
      const moved = haversineKm(lastCheckLat, lastCheckLng, lat, lng);
      if (moved < MIN_MOVE_KM) return true;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Prüft GPS gegen Städtekatalog. Zeigt einmalig einen Wechsel-Dialog,
 * wenn eine andere Stadt mindestens 5 km näher ist als die gewählte.
 */
export async function checkCityProximity(lat: number, lng: number): Promise<void> {
  if (promptOpen) return;
  if (useFinnusStore.getState().isSimulationMode) return;

  const profile = getCachedUserProfile();
  if (!profile?.cityId || !profile.setupComplete) return;

  if (shouldThrottle(lat, lng)) return;
  lastCheckAt = Date.now();
  lastCheckLat = lat;
  lastCheckLng = lng;

  const catalog = await getCatalog();
  if (catalog.length < 2) return;

  const withDistance = catalog.map((item) => {
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number') {
      return { ...item, distanceKm: null as number | null };
    }
    return {
      ...item,
      distanceKm: haversineKm(lat, lng, item.lat, item.lng),
    };
  });

  const sorted = [...withDistance].sort((a, b) => {
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    return da - db;
  });

  const nearest = sorted[0];
  const selected = withDistance.find((c) => c.id === profile.cityId);
  if (!nearest || !selected || nearest.id === selected.id) return;
  if (nearest.distanceKm == null || selected.distanceKm == null) return;

  const gap = selected.distanceKm - nearest.distanceKm;
  if (gap < SWITCH_GAP_KM) return;

  if (
    lastDismissedCityId === nearest.id &&
    Date.now() - lastDismissedAt < DISMISS_COOLDOWN_MS
  ) {
    return;
  }

  promptOpen = true;
  const nearestKm = nearest.distanceKm.toFixed(1);
  const selectedKm = selected.distanceKm.toFixed(1);

  Alert.alert(
    `${nearest.symbol ?? '📍'} ${nearest.name}?`,
    `Du bist gerade näher an ${nearest.name} (${nearestKm} km) als an ${selected.name ?? 'deiner Stadt'} (${selectedKm} km). Soll ich auf ${nearest.name} umschalten?`,
    [
      {
        text: 'Nein, danke',
        style: 'cancel',
        onPress: () => {
          lastDismissedCityId = nearest.id;
          lastDismissedAt = Date.now();
          promptOpen = false;
        },
      },
      {
        text: `Ja, ${nearest.name}`,
        onPress: () => {
          void (async () => {
            try {
              await applyCitySwitch(nearest);
            } catch (err) {
              console.warn('[cityProximity] switch failed:', err);
            } finally {
              promptOpen = false;
            }
          })();
        },
      },
    ],
    { cancelable: true, onDismiss: () => { promptOpen = false; } },
  );
}
