/**
 * Stadt-Begrüßung:
 * - Erster Besuch (Registrierung / Ortswechsel / erstes Betreten): Willkommen +
 *   narrative Orts-Historie (max. 1000 Zeichen Historie+Heute) + was heute abgeht / erkunden.
 * - Wiederkehr: frühestens nach 150 h — ohne Historie, mit Rückkehr-Hook,
 *   Datensatz-Änderungen und personalisierten Vorschlägen.
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
import { generateGeminiText, hasGeminiApiKey } from './geminiService';
import { isDeviceOffline } from './navigation/networkState';
import { loadStampPassport } from './navigation/stampPassportPersistence';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { useSessionPlanStore } from '../store/useSessionPlanStore';
import type { PoiHookKind } from './ai/fastHook';

const STATE_PATH = `${FileSystem.documentDirectory}findus-city-welcome.json`;
const ENTER_RADIUS_KM = 8;
const APPROACH_RADIUS_KM = 18;
const CHECK_INTERVAL_MS = 60_000;

/** Willkommensnachricht in bekannter Stadt frühestens nach 150 h erneut */
export const CITY_RETURN_WELCOME_MS = 150 * 60 * 60_000;

const SUGGEST_KINDS = new Set<PoiHookKind | string>([
  'museum',
  'park',
  'nature',
  'cafe',
  'bakery',
  'market',
  'shop',
  'bar',
  'historic',
  'castle',
  'water',
  'sports',
  'golf',
]);

const EXCLUDE_KINDS = new Set<PoiHookKind | string>([
  'station',
  'service',
  'atm',
  'fire',
]);

type CityWelcomeRecord = {
  firstWelcomeAtMs: number;
  lastWelcomeAtMs: number;
  visitCount: number;
  lastPoiCount: number | null;
};

type WelcomeState = {
  /** @deprecated legacy — migriert nach cities */
  shownCityIds?: string[];
  cities: Record<string, CityWelcomeRecord>;
};

export type CityWelcomeMode = 'first_enter' | 'switch' | 'return';

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

function emptyState(): WelcomeState {
  return { cities: {} };
}

async function loadState(): Promise<WelcomeState> {
  if (cached) return cached;
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (info.exists) {
      const raw = JSON.parse(
        await FileSystem.readAsStringAsync(STATE_PATH),
      ) as Partial<WelcomeState> & {
        shownCityIds?: unknown;
        cities?: Record<string, Partial<CityWelcomeRecord>>;
      };
      const cities: Record<string, CityWelcomeRecord> = {};
      if (raw.cities && typeof raw.cities === 'object') {
        for (const [id, rec] of Object.entries(raw.cities)) {
          if (!rec || typeof rec !== 'object') continue;
          const first = Number(rec.firstWelcomeAtMs);
          const last = Number(rec.lastWelcomeAtMs);
          if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
          cities[id] = {
            firstWelcomeAtMs: first,
            lastWelcomeAtMs: last,
            visitCount:
              typeof rec.visitCount === 'number' && rec.visitCount > 0
                ? rec.visitCount
                : 1,
            lastPoiCount:
              typeof rec.lastPoiCount === 'number' ? rec.lastPoiCount : null,
          };
        }
      }
      // Legacy: shownCityIds → cities ohne Zeitstempel (als „schon begrüßt“)
      if (Array.isArray(raw.shownCityIds)) {
        const now = Date.now();
        for (const id of raw.shownCityIds.map(String)) {
          if (cities[id]) continue;
          cities[id] = {
            firstWelcomeAtMs: now,
            lastWelcomeAtMs: now,
            visitCount: 1,
            lastPoiCount: null,
          };
        }
      }
      cached = { cities };
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = emptyState();
  return cached;
}

async function persist(state: WelcomeState): Promise<void> {
  cached = state;
  try {
    await FileSystem.writeAsStringAsync(
      STATE_PATH,
      JSON.stringify({ cities: state.cities }),
    );
  } catch (err) {
    console.warn('[cityWelcome] persist failed:', err);
  }
}

function currentPoiCount(): number {
  try {
    return useFinnusStore.getState().pois?.length ?? 0;
  } catch {
    return 0;
  }
}

function isSuggestableKind(kind: string): boolean {
  const k = kind.toLowerCase();
  if (EXCLUDE_KINDS.has(k)) return false;
  if (SUGGEST_KINDS.has(k)) return true;
  // restaurant / attraction aus Memory
  if (k === 'restaurant' || k === 'attraction' || k === 'custom') return true;
  if (k === 'hotel' || k === 'transit') return false;
  return false;
}

async function buildReturnContext(cityId: string): Promise<{
  favorites: string[];
  unfinished: string[];
  wanted: string[];
  newPlaceHint: string | null;
  lastPoiCount: number | null;
  currentPoiCount: number;
}> {
  const profile = getCachedUserProfile();
  const poiCount = currentPoiCount();
  const state = await loadState();
  const prev = state.cities[cityId];
  const lastPoiCount = prev?.lastPoiCount ?? null;

  let newPlaceHint: string | null = null;
  if (
    lastPoiCount != null &&
    poiCount > lastPoiCount &&
    poiCount - lastPoiCount >= 1
  ) {
    const delta = poiCount - lastPoiCount;
    newPlaceHint = `${delta} neue Orte im Datensatz seit dem letzten Besuch`;
  }

  const stamps = await loadStampPassport().catch(() => []);
  const visitCounts = new Map<string, { name: string; n: number; kind: string }>();
  for (const e of stamps) {
    if (!isSuggestableKind(e.kind)) continue;
    const key = e.name.trim().toLowerCase();
    if (!key) continue;
    const cur = visitCounts.get(key);
    if (cur) cur.n += 1;
    else visitCounts.set(key, { name: e.name.trim(), n: 1, kind: e.kind });
  }
  const favorites = [...visitCounts.values()]
    .filter((v) => v.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((v) => `${v.name} (${v.kind}, ${v.n}×)`);

  // Falls keine Mehrfachbesuche: Top-3 besuchte suggestable Orte
  if (favorites.length === 0) {
    const singles = [...visitCounts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((v) => `${v.name} (${v.kind})`);
    favorites.push(...singles);
  }

  const mem = useUserMemoryStore.getState();
  const entities = mem
    .findEntities({ cityId })
    .filter((e) => isSuggestableKind(e.type) && e.name.trim())
    .slice(0, 8);

  for (const e of entities) {
    if (favorites.length >= 3) break;
    const label = e.name.trim();
    if (favorites.some((f) => f.toLowerCase().includes(label.toLowerCase()))) {
      continue;
    }
    favorites.push(`${label} (${e.type})`);
  }

  const unfinished: string[] = [];
  const sessionPlan = useSessionPlanStore.getState().plan;
  if (sessionPlan?.active && sessionPlan.stops?.length) {
    for (const s of sessionPlan.stops) {
      if (s.done) continue;
      const label = (s.label ?? '').trim();
      if (label) unfinished.push(label);
      if (unfinished.length >= 4) break;
    }
  }

  const wanted: string[] = [];
  const want = profile?.wantToExperience?.trim();
  if (want) wanted.push(want.slice(0, 120));

  return {
    favorites: favorites.slice(0, 3),
    unfinished: unfinished.slice(0, 4),
    wanted,
    newPlaceHint,
    lastPoiCount,
    currentPoiCount: poiCount,
  };
}

/**
 * Live Gemini-Stadtbegrüßung.
 */
export async function generateLiveCityWelcome(
  city: Pick<CityCatalogItem, 'id' | 'name' | 'symbol'>,
  opts?: { mode?: CityWelcomeMode },
): Promise<string> {
  const mode = opts?.mode ?? 'first_enter';
  const name = city.name?.trim() || city.id;
  const sym = city.symbol?.trim() || '';
  const offline = await isDeviceOffline().catch(() => false);
  const profile = getCachedUserProfile();
  const userName = profile?.firstName?.trim() || null;

  if (mode === 'return') {
    const ctx = await buildReturnContext(city.id);
    if (!offline && hasGeminiApiKey()) {
      const prompt = [
        'Du bist Findus — lockerer Fußgänger-/Reisebegleiter auf Deutsch.',
        'Der User war schon mal in dieser Stadt. Schreib GENAU EINE Rückkehr-Begrüßung.',
        'Regeln:',
        '- Du-Form, Alltagsdeutsch, kein Markdown.',
        '- KEINE Orts-Historie / Geschichts-Erzählung.',
        '- Ton: cool, dass du wieder hier bist — wirklich schöne Stadt.',
        '- Wenn Datensatz-Änderungen genannt sind: kurz erwähnen, was neu/relevant sein könnte.',
        '- Danach Vorschläge: offene Orte vom letzten Mal, Wünsche, oder 3 Beispiele aus Favoriten',
        '  (Restaurants, Museen, Parks, Shopping — NIEMALS Verkehr/Bahnhof/Unterkunft).',
        '- Max. ca. 90 Wörter.',
        userName ? `User-Name: ${userName}` : 'Kein Name.',
        `Stadtname: ${name}`,
        ctx.newPlaceHint
          ? `Datensatz: ${ctx.newPlaceHint} (aktuell ${ctx.currentPoiCount} Orte).`
          : `Datensatz: keine klare Zunahme (aktuell ${ctx.currentPoiCount} Orte).`,
        ctx.unfinished.length
          ? `Noch offen / nicht geschafft: ${ctx.unfinished.join('; ')}`
          : 'Keine offenen Stopps bekannt.',
        ctx.wanted.length
          ? `User wollte erleben: ${ctx.wanted.join('; ')}`
          : 'Kein expliziter Wunsch-Text.',
        ctx.favorites.length
          ? `Favoriten / oft da: ${ctx.favorites.join('; ')}`
          : 'Keine Favoriten bekannt — nenne dann 3 typische Erlebnisrichtungen (Essen, Kultur, Park/Shopping) ohne Fake-Namen.',
      ].join('\n');

      try {
        const live = await generateGeminiText(prompt, {
          task: 'generic',
          maxTokens: 280,
          temperature: 0.85,
        });
        const cleaned = live
          .replace(/^["„]|["“]$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length >= 20) return cleaned;
      } catch (err) {
        console.warn('[cityWelcome] return gemini failed:', err);
      }
    }

    const who = userName ? ` ${userName}` : '';
    const tip =
      ctx.unfinished[0] ??
      ctx.favorites[0]?.split(' (')[0] ??
      'Restaurants, Museen oder einen schönen Park';
    const neu = ctx.newPlaceHint
      ? ` Übrigens: ${ctx.newPlaceHint.toLowerCase()} — könnte was für dich sein.`
      : '';
    return `Cool${who}, dass du wieder in ${name} bist — wirklich eine schöne Stadt.${neu} Wie wär's mit ${tip}?`;
  }

  // first_enter / switch
  if (!offline && hasGeminiApiKey()) {
    const prompt = [
      'Du bist Findus — lockerer Fußgänger-/Reisebegleiter auf Deutsch.',
      'Schreib GENAU EINE Stadt-Willkommensnachricht für den ERSTEN Besuch.',
      'Struktur (zwingend):',
      `1) Kurz willkommen heißen in ${name}${userName ? ` (Name: ${userName})` : ''}.`,
      '2) Dann EINE spannende, narrative Mini-Geschichte zur Historie des Ortes',
      '   — packend, bildhaft, direkt ins Geschehen (kein Wikipedia-Ton).',
      '3) Dann: was heutzutage in der Stadt abgeht und was man hier erkunden kann.',
      'Regeln:',
      '- Du-Form, Alltagsdeutsch, kein Markdown, kein Emoji-Overkill.',
      '- Keine erfundenen Öffnungszeiten oder Ticketpreise.',
      '- Gesamtlänge MAXIMAL 1000 Zeichen für Historie UND Heute zusammen.',
      '- Stil wie Reportage: Schlamm/Höfe/Menschen — Lust auf mehr machen.',
      `Modus: ${mode === 'switch' ? 'Stadtwechsel' : 'erstes Betreten'}.`,
      `Stadtname: ${name}`,
      `Stadt-ID: ${city.id}`,
      sym ? `Symbol (optional): ${sym}` : 'Kein Symbol.',
      profile?.wantToExperience?.trim()
        ? `User-Interesse: ${profile.wantToExperience.trim().slice(0, 100)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const live = await generateGeminiText(prompt, {
        task: 'generic',
        maxTokens: 420,
        temperature: 0.9,
      });
      const cleaned = live
        .replace(/^["„]|["“]$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 40) return cleaned;
    } catch (err) {
      console.warn('[cityWelcome] gemini failed:', err);
    }
  }

  const prefix = sym ? `${sym} ` : '';
  const who = userName ? ` ${userName}` : '';
  return (
    `${prefix}Willkommen${who} in ${name}! ` +
    `Diese Stadt hat Charakter — alte Geschichten und ein lebendiges Heute. ` +
    `Ich zeig dir, was hier abgeht und was sich zu erkunden lohnt. Sag mir, wohin oder worauf du Lust hast.`
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

function resolveModeForCity(
  record: CityWelcomeRecord | undefined,
  preferSwitch: boolean,
): CityWelcomeMode | null {
  const now = Date.now();
  if (!record) {
    return preferSwitch ? 'switch' : 'first_enter';
  }
  if (now - record.lastWelcomeAtMs < CITY_RETURN_WELCOME_MS) {
    return null;
  }
  return 'return';
}

/**
 * Begrüßt für eine bekannte Stadt (Onboarding, Switch, GPS-Enter).
 * Gibt false wenn Cooldown / busy / Setup unvollständig.
 */
export async function speakCityWelcomeForCity(
  city: Pick<CityCatalogItem, 'id' | 'name' | 'symbol'>,
  opts?: { preferSwitch?: boolean; forceMode?: CityWelcomeMode },
): Promise<boolean> {
  if (speaking) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;

  const state = await loadState();
  const record = state.cities[city.id];
  const mode =
    opts?.forceMode ??
    resolveModeForCity(record, opts?.preferSwitch === true);
  if (!mode) return false;

  speaking = true;
  try {
    const intro = await generateLiveCityWelcome(city, { mode });
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: intro,
    });
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(intro, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });

    const now = Date.now();
    const poiCount = currentPoiCount();
    const nextRec: CityWelcomeRecord = {
      firstWelcomeAtMs: record?.firstWelcomeAtMs ?? now,
      lastWelcomeAtMs: now,
      visitCount: (record?.visitCount ?? 0) + 1,
      lastPoiCount: poiCount > 0 ? poiCount : (record?.lastPoiCount ?? null),
    };
    await persist({
      cities: { ...state.cities, [city.id]: nextRec },
    });
    return true;
  } catch (err) {
    console.warn('[cityWelcome] speak failed:', err);
    return false;
  } finally {
    speaking = false;
  }
}

/**
 * GPS-Tick: Begrüßung für neue / fällige Stadt.
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

  return speakCityWelcomeForCity(city);
}

/** Für Tests / Reset. */
export async function resetCityWelcomeState(): Promise<void> {
  await persist(emptyState());
}
