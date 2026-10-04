/**
 * Stadt-Begrüßung:
 * - Erster Besuch vor Ort: szenische Welcome-Blaupause (FINDUS_CITY_WELCOME_BLOCK, ~1300 Zeichen).
 * - Pack remote geöffnet (GPS nicht in der Stadt): kurz pack_remote — Orte auf Karte, kein Tourguide.
 * - Schon mal da (Stempel/Visit-Log/Welcome-Record): kein volles Programm —
 *   kurze Rückkehr (max. ~40 Wörter), max. EIN Vorschlag.
 * - Wiederkehr-Speech frühestens nach 150 h erneut; dazwischen still.
 * - First-open nach Erklärung: `runPostExplanationCityWelcome` (Onboarding).
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
import type { UserProfile } from '../types/userProfile';
import { FINDUS_CITY_WELCOME_BLOCK, FINDUS_CITY_PACK_REMOTE_OPEN_BLOCK, FINDUS_SPEECH_CULTURE_BLOCK } from './concierge/findusResponsePolicy';
import {
  ensureCityWelcomeFacts,
  formatWelcomeFactsForPrompt,
  type CityWelcomeFacts,
} from './cityWelcomeFacts';
import { buildPersonalityMatrixPromptBlock } from './persona/personalityMatrixPrompt';

const STATE_PATH = `${FileSystem.documentDirectory}findus-city-welcome.json`;
const ENTER_RADIUS_KM = 8;
const APPROACH_RADIUS_KM = 18;
const CHECK_INTERVAL_MS = 60_000;
/** Stempel nahe Stadtmitte = schon mal da gewesen */
const PRIOR_VISIT_STAMP_KM = 12;

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

export type CityWelcomeMode = 'first_enter' | 'switch' | 'return' | 'pack_remote';

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
  if (k === 'restaurant' || k === 'attraction' || k === 'custom') return true;
  if (k === 'hotel' || k === 'transit') return false;
  return false;
}

/**
 * Schon mal in der Stadt gewesen? Welcome-Record, Visit-Log oder Stempel nahe Zentrum.
 */
export async function hasPriorCityVisit(
  city: Pick<CityCatalogItem, 'id' | 'name' | 'lat' | 'lng'>,
): Promise<boolean> {
  const id = String(city.id).toLowerCase();
  try {
    const state = await loadState();
    const rec = state.cities[city.id] ?? state.cities[id];
    if (rec && rec.visitCount >= 1) return true;
  } catch {
    /* soft */
  }

  try {
    const { getVisitLogSnapshot, hydrateVisitLog } = require('./timeline/visitLog') as {
      hydrateVisitLog: () => Promise<unknown>;
      getVisitLogSnapshot: () => Array<{ cityId?: string | null }>;
    };
    await hydrateVisitLog();
    const log = getVisitLogSnapshot();
    if (
      log.some(
        (e) =>
          typeof e.cityId === 'string' && e.cityId.toLowerCase() === id,
      )
    ) {
      return true;
    }
  } catch {
    /* soft */
  }

  const lat = typeof city.lat === 'number' ? city.lat : null;
  const lng = typeof city.lng === 'number' ? city.lng : null;
  if (lat != null && lng != null) {
    try {
      const stamps = await loadStampPassport();
      if (
        stamps.some(
          (s) =>
            typeof s.lat === 'number' &&
            typeof s.lng === 'number' &&
            haversineKm(lat, lng, s.lat, s.lng) <= PRIOR_VISIT_STAMP_KM,
        )
      ) {
        return true;
      }
    } catch {
      /* soft */
    }
  }

  try {
    const { isCityMapGreen } = require('./homeMap/cityDwellTracker') as {
      isCityMapGreen: (id: string) => boolean;
    };
    if (isCityMapGreen(id)) return true;
  } catch {
    /* soft */
  }

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
  const visitCounts = new Map<
    string,
    { name: string; n: number; kind: string }
  >();
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
    .slice(0, 2)
    .map((v) => `${v.name} (${v.kind})`);

  if (favorites.length === 0) {
    const singles = [...visitCounts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 1)
      .map((v) => `${v.name} (${v.kind})`);
    favorites.push(...singles);
  }

  const mem = useUserMemoryStore.getState();
  const entities = mem
    .findEntities({ cityId })
    .filter((e) => isSuggestableKind(e.type) && e.name.trim())
    .slice(0, 4);

  for (const e of entities) {
    if (favorites.length >= 2) break;
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
      if (unfinished.length >= 2) break;
    }
  }

  const wanted: string[] = [];
  const want = profile?.wantToExperience?.trim();
  if (want) wanted.push(want.slice(0, 80));

  return {
    favorites: favorites.slice(0, 2),
    unfinished: unfinished.slice(0, 2),
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
  opts?: {
    mode?: CityWelcomeMode;
    weatherLine?: string | null;
    eventHints?: Array<{ name: string; whenLabel: string; hook: string }>;
    facts?: CityWelcomeFacts | null;
  },
): Promise<string> {
  const mode = opts?.mode ?? 'first_enter';
  const name = city.name?.trim() || city.id;
  const sym = city.symbol?.trim() || '';
  const offline = await isDeviceOffline().catch(() => false);
  const profile = getCachedUserProfile();
  const userName = profile?.firstName?.trim() || null;
  const facts =
    opts?.facts ??
    (await ensureCityWelcomeFacts(city.id).catch(() => null));
  const factsBlock = formatWelcomeFactsForPrompt(facts);

  if (mode === 'pack_remote') {
    if (!offline && hasGeminiApiKey()) {
      const prompt = [
        'Du bist Yorro — lockerer Reisebegleiter auf Deutsch.',
        FINDUS_CITY_PACK_REMOTE_OPEN_BLOCK,
        `Stadtname: ${name}`,
        userName ? `User-Vorname (sparsam, optional): ${userName}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      try {
        const live = await generateGeminiText(prompt, {
          task: 'generic',
          maxTokens: 120,
          temperature: 0.85,
        });
        const cleaned = live
          .replace(/^["„]|["“]$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length >= 12 && cleaned.length <= 280) return cleaned;
        if (cleaned.length > 280) {
          return `${cleaned.slice(0, 260).replace(/\s+\S*$/, '')}…`;
        }
      } catch (err) {
        console.warn('[cityWelcome] pack_remote gemini failed:', err);
      }
    }
    const who = userName ? ` ${userName}` : '';
    return `Viel Spaß beim Erkunden von ${name}${who} — die Orte liegen auf der Karte.`;
  }

  if (mode === 'return') {
    const ctx = await buildReturnContext(city.id);
    if (!offline && hasGeminiApiKey()) {
      const tipSource =
        ctx.unfinished[0] ??
        ctx.wanted[0] ??
        ctx.favorites[0]?.split(' (')[0] ??
        null;
      const prompt = [
        'Du bist Yorro — lockerer Reisebegleiter auf Deutsch.',
        'FLOW-BLAUPAUSE Rückkehr (Wortlaut frei, nie festen Satz übernehmen):',
        'Kurzes Wiedersehen → optional 1 neuer Datensatz-Hinweis → max. EIN konkreter Vorschlag.',
        'Regeln:',
        '- Du-Form, Alltagsdeutsch, kein Markdown.',
        '- KEINE Orts-Historie, keine Stadtführung, kein „volles Programm“.',
        '- Max. 40 Wörter. Max. 1 Vorschlag (kein Aufzählen von 3 Optionen).',
        '- Namen des Users nur wenn natürlich, nicht erzwingen.',
        `Stadt: ${name}`,
        ctx.newPlaceHint ? `Neu im Pack: ${ctx.newPlaceHint}` : 'Kein Pack-Delta.',
        tipSource
          ? `Ein Vorschlags-Anker (nur denselben nutzen): ${tipSource}`
          : 'Kein Anker — dann nur kurzes Wiedersehen, kein Fake-Ort.',
        'Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut.',
      ].join('\n');

      try {
        const live = await generateGeminiText(prompt, {
          task: 'generic',
          maxTokens: 120,
          temperature: 0.8,
        });
        const cleaned = live
          .replace(/^["„]|["“]$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length >= 12 && cleaned.length <= 320) return cleaned;
        if (cleaned.length > 320) {
          return `${cleaned.slice(0, 300).replace(/\s+\S*$/, '')}…`;
        }
      } catch (err) {
        console.warn('[cityWelcome] return gemini failed:', err);
      }
    }

    const who = userName ? ` ${userName}` : '';
    const tip =
      ctx.unfinished[0] ?? ctx.favorites[0]?.split(' (')[0] ?? null;
    const neu = ctx.newPlaceHint
      ? ` ${ctx.newPlaceHint.replace(/im Datensatz seit dem letzten Besuch/i, 'neu im Pack')}.`
      : '';
    if (tip) {
      return `Schön wieder in ${name}${who}.${neu} ${tip}?`;
    }
    return `Schön wieder in ${name}${who}.${neu}`.trim();
  }

  // first_enter / switch — nur wenn wirklich erster Kontakt
  if (!offline && hasGeminiApiKey()) {
    let tripHint = '';
    try {
      const { useTripModeStore } = require('../store/useTripModeStore') as {
        useTripModeStore: {
          getState: () => {
            active: boolean;
            cityName: string | null;
            dayCount: number;
            isTripCity: (id?: string | null, name?: string | null) => boolean;
            getTripDayIndex: () => number | null;
          };
        };
      };
      const trip = useTripModeStore.getState();
      if (trip.active && trip.isTripCity(city.id, name)) {
        const idx = trip.getTripDayIndex();
        if (idx != null) {
          tripHint = `Trip-Kontext: Tag ${idx} von ${trip.dayCount}${
            trip.cityName ? ` in ${trip.cityName}` : ''
          }. Begrüße wie zum Start eines Städtetrips (kurz Ankommen, was heute lohnt) — kein Alltags-Chat.`;
        }
      }
    } catch {
      /* soft */
    }

    const eventBlock =
      (opts?.eventHints ?? [])
        .slice(0, 2)
        .map(
          (e) =>
            `- ${e.name}${e.whenLabel ? ` · ${e.whenLabel}` : ''}${e.hook ? `: ${e.hook.slice(0, 140)}` : ''}`,
        )
        .join('\n') || '';
    const weatherLine = (opts?.weatherLine || '').trim();

    const prompt = [
      'Du bist Yorro — charismatischer Fußgänger-/Reisebegleiter auf Deutsch.',
      'Schreib GENAU EINE Stadt-Willkommensnachricht für den ERSTEN Besuch / Stadtwechsel.',
      FINDUS_SPEECH_CULTURE_BLOCK,
      buildPersonalityMatrixPromptBlock(profile),
      FINDUS_CITY_WELCOME_BLOCK,
      factsBlock ||
        'Keine Pack-Historie geladen — nutze nur allgemein bekannte, sichere Stadt-Fakten; erfinde keine Details.',
      userName ? `User-Vorname (sparsam, max. 1×): ${userName}` : '',
      `Modus: ${mode === 'switch' ? 'Stadtwechsel' : 'erstes Betreten'}.`,
      `Stadtname: ${name}`,
      `Stadt-ID: ${city.id}`,
      sym ? `Symbol (optional, nicht vorlesen): ${sym}` : '',
      profile?.wantToExperience?.trim()
        ? `User-Interesse: ${profile.wantToExperience.trim().slice(0, 100)}`
        : '',
      weatherLine
        ? `Wetter-Fakten (optional einweben, nicht erfinden): ${weatherLine}`
        : 'Kein Wetter — Wetter weglassen.',
      eventBlock
        ? `Heutige Events in ~5 km (belegt, optional ein Highlight):\n${eventBlock}`
        : 'Keine belegten Events — Event weglassen.',
      tripHint,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const live = await generateGeminiText(prompt, {
        task: 'generic',
        maxTokens: 900,
        temperature: 0.9,
      });
      const cleaned = live
        .replace(/^["„]|["“]$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 40) {
        return cleaned.length > 1350
          ? `${cleaned.slice(0, 1300).replace(/\s+\S*$/, '')}…`
          : cleaned;
      }
    } catch (err) {
      console.warn('[cityWelcome] gemini failed:', err);
    }
  }

  const prefix = sym ? `${sym} ` : '';
  const who = userName ? ` ${userName}` : '';
  return (
    `${prefix}Willkommen${who} in ${name}! ` +
    `Diese Stadt hat Charakter — alte Geschichten und ein lebendiges Heute. ` +
    `Sag mir, wohin oder worauf du Lust hast.`
  );
}

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

async function resolveModeForCity(
  city: Pick<CityCatalogItem, 'id' | 'name' | 'lat' | 'lng'>,
  record: CityWelcomeRecord | undefined,
  preferSwitch: boolean,
  manualPick?: boolean,
): Promise<CityWelcomeMode | null> {
  const now = Date.now();
  const prior = await hasPriorCityVisit(city);

  if (record) {
    if (
      !manualPick &&
      now - record.lastWelcomeAtMs < CITY_RETURN_WELCOME_MS
    ) {
      return null;
    }
    return 'return';
  }

  // Kein Welcome-Record, aber Stempel/Visit-Log → kein volles Erstprogramm
  if (prior) {
    return 'return';
  }

  return preferSwitch ? 'switch' : 'first_enter';
}

/**
 * Begrüßt für eine bekannte Stadt (Onboarding, Switch, GPS-Enter).
 * Gibt false wenn Cooldown / busy / Setup unvollständig.
 * Manueller Pack-Open ohne GPS vor Ort → kurzes pack_remote (kein Voll-Welcome, kein Record).
 */
export async function speakCityWelcomeForCity(
  city: Pick<CityCatalogItem, 'id' | 'name' | 'symbol'> &
    Partial<Pick<CityCatalogItem, 'lat' | 'lng'>>,
  opts?: {
    preferSwitch?: boolean;
    forceMode?: CityWelcomeMode;
    /** Manueller Stadt-Tap in Einstellungen — Rückkehr erlauben, kein 150-h-Stille. */
    manualPick?: boolean;
  },
): Promise<boolean> {
  if (speaking) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;
  try {
    const { isProactiveAlertEnabled } = require('./notifications/proactiveAlerts') as {
      isProactiveAlertEnabled: (
        k: 'cityWelcome',
        p?: unknown,
      ) => boolean;
    };
    if (!isProactiveAlertEnabled('cityWelcome', profile)) return false;
  } catch {
    /* soft */
  }

  const physicallyHere = await isPhysicallyInCity(city);
  const remotePackOpen = opts?.manualPick === true && !physicallyHere;

  const state = await loadState();
  const record = state.cities[city.id];

  // Slim-Historie zuerst — entscheidet, ob Remote nur Kurzgruß oder echte Story.
  const facts = await ensureCityWelcomeFacts(city.id, {
    allowFullPack: false,
  }).catch(() => null);

  const mode: CityWelcomeMode | null =
    opts?.forceMode ??
    (remotePackOpen && !(facts?.history || facts?.speech)
      ? 'pack_remote'
      : await resolveModeForCity(
          {
            id: city.id,
            name: city.name,
            lat: city.lat,
            lng: city.lng,
          },
          record,
          opts?.preferSwitch === true,
          opts?.manualPick === true,
        ));
  if (!mode) return false;

  speaking = true;
  try {
    const prior = await hasPriorCityVisit(city);
    // Vorproduzierte Speech nur Erstbesuch/Switch ohne Prior — nie Rückkehr/Remote.
    let intro = '';
    if (
      !prior &&
      mode !== 'return' &&
      mode !== 'pack_remote' &&
      (mode === 'first_enter' || mode === 'switch') &&
      facts?.speech &&
      facts.speech.trim().length >= 60
    ) {
      const baked = facts.speech.trim();
      try {
        const { shouldRejectBakedWelcomeSpeech } = await import(
          './cityWelcomeSpeechQuality'
        );
        if (!shouldRejectBakedWelcomeSpeech(baked, city.id, city.name)) {
          intro = baked;
        }
      } catch {
        intro = baked;
      }
    }
    // Historie da, aber keine baked speech → lokal backen (kein Gemini-Hang).
    if (
      !intro &&
      (mode === 'first_enter' || mode === 'switch') &&
      facts?.history &&
      facts.history.trim().length >= 40
    ) {
      try {
        const { bakeWelcomeSpeechLocal } = await import('./cityWelcomeFacts');
        intro = bakeWelcomeSpeechLocal({
          name: city.name,
          history: facts.history,
          highlights: facts.highlights || [],
          todayHint: facts.todayHint,
        });
      } catch {
        /* soft */
      }
    }
    if (!intro) {
      intro = await generateLiveCityWelcome(city, { mode, facts });
    }

    try {
      const { isWelcomeSpeechContaminated } = await import(
        './cityWelcomeSpeechQuality'
      );
      if (
        mode !== 'pack_remote' &&
        isWelcomeSpeechContaminated(intro, city.id, city.name)
      ) {
        intro = await generateLiveCityWelcome(city, {
          mode,
          facts: facts
            ? { ...facts, speech: undefined }
            : facts,
        });
        if (isWelcomeSpeechContaminated(intro, city.id, city.name)) {
          const { bakeWelcomeSpeechLocal } = await import('./cityWelcomeFacts');
          intro = bakeWelcomeSpeechLocal({
            name: city.name,
            history: facts?.history || '',
            highlights: facts?.highlights || [],
            todayHint: facts?.todayHint,
          });
        }
      }
    } catch {
      /* soft */
    }
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: intro,
    });
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(intro, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });

    // Remote-Pack-Open: kein Welcome-Record — volles Programm bleibt für GPS-Ankunft.
    if (mode === 'pack_remote') return true;

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

async function isPhysicallyInCity(
  city: Partial<Pick<CityCatalogItem, 'lat' | 'lng' | 'id'>>,
): Promise<boolean> {
  let lat = useFinnusStore.getState().lastGpsLat;
  let lng = useFinnusStore.getState().lastGpsLng;
  try {
    const { useGpsStore } = require('../store/useGpsStore') as {
      useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
    };
    const g = useGpsStore.getState();
    if (typeof g.lat === 'number') lat = g.lat;
    if (typeof g.lng === 'number') lng = g.lng;
  } catch {
    /* soft */
  }
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }
  let cLat = typeof city.lat === 'number' ? city.lat : null;
  let cLng = typeof city.lng === 'number' ? city.lng : null;
  if (cLat == null || cLng == null) {
    try {
      const catalog = await loadCityCatalog(null);
      const hit = catalog.find((c) => c.id === city.id);
      if (hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
        cLat = hit.lat;
        cLng = hit.lng;
      }
    } catch {
      return false;
    }
  }
  if (cLat == null || cLng == null) return false;
  return haversineKm(lat, lng, cLat, cLng) <= ENTER_RADIUS_KM;
}

/**
 * Nach der App-Erklärung: volle Erst-Begrüßung (Historie + Wetter + Event in 5 km).
 */
export async function runPostExplanationCityWelcome(
  profile: UserProfile,
): Promise<boolean> {
  if (speaking) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  const cityName = (profile.cityName ?? profile.cityId ?? '').trim();
  const cityId = (profile.cityId ?? '').trim() || cityName.toLowerCase();
  if (!cityName || !cityId) return false;

  speaking = true;
  try {
    let catalogCity: CityCatalogItem | null = null;
    try {
      const catalog = await loadCityCatalog(null);
      catalogCity =
        catalog.find((c) => c.id === cityId) ||
        catalog.find(
          (c) => c.name.toLowerCase() === cityName.toLowerCase(),
        ) ||
        null;
    } catch {
      catalogCity = null;
    }
    const city = {
      id: catalogCity?.id || cityId,
      name: catalogCity?.name || cityName,
      symbol: catalogCity?.symbol,
      lat: catalogCity?.lat,
      lng: catalogCity?.lng,
    };

    let weatherLine: string | null = null;
    try {
      const { getCachedWeatherSummary, getCachedWeatherSnapshot } = await import(
        './weatherService'
      );
      weatherLine =
        getCachedWeatherSummary()?.trim() ||
        getCachedWeatherSnapshot()?.summaryLine?.trim() ||
        null;
    } catch {
      weatherLine = null;
    }

    const eventHints: Array<{ name: string; whenLabel: string; hook: string }> =
      [];
    try {
      const { isNachtruhe } = await import('./ui/nachtruhePolicy');
      if (!isNachtruhe()) {
        const { useGpsStore } = await import('../store/useGpsStore');
        const gps = useGpsStore.getState();
        const lat =
          typeof gps.lat === 'number' ? gps.lat : city.lat ?? null;
        const lng =
          typeof gps.lng === 'number' ? gps.lng : city.lng ?? null;
        if (typeof lat === 'number' && typeof lng === 'number') {
          const { researchTemporaryLiveSpots } = await import(
            './research/temporaryLiveSpots'
          );
          const spots = await researchTemporaryLiveSpots({
            lat,
            lng,
            cityHint: city.name,
            timeoutMs: 2_500,
            maxDistanceM: 5_000,
            forAmbientPitch: true,
          });
          for (const s of spots.slice(0, 2)) {
            eventHints.push({
              name: s.name,
              whenLabel: s.whenLabel,
              hook: s.hook,
            });
          }
          if (spots[0]) {
            const { noteEventPitchSpoken } = await import(
              './research/eventPitchMemory'
            );
            await noteEventPitchSpoken(spots[0]).catch(() => undefined);
          }
        }
      }
    } catch {
      /* soft */
    }

    const intro = await generateLiveCityWelcome(city, {
      mode: 'first_enter',
      weatherLine,
      eventHints,
    });
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: intro,
    });
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(intro, {
      voiceId: profile.voiceId || voice.voiceId,
      speechRate: voice.speechRate,
    });
    await markCityWelcomeSpoken(city.id);
    return true;
  } catch (err) {
    console.warn('[cityWelcome] post-explanation failed:', err);
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

/**
 * Markiert Stadt-Welcome als gesprochen (ohne TTS) —
 * z. B. nach First-Open-Kette in der Erklärung.
 */
export async function markCityWelcomeSpoken(
  cityId: string,
  opts?: { poiCount?: number | null },
): Promise<void> {
  const id = String(cityId || '').trim();
  if (!id) return;
  const state = await loadState();
  const record = state.cities[id];
  const now = Date.now();
  const poiCount =
    opts?.poiCount != null && Number.isFinite(opts.poiCount)
      ? opts.poiCount
      : currentPoiCount();
  const nextRec: CityWelcomeRecord = {
    firstWelcomeAtMs: record?.firstWelcomeAtMs ?? now,
    lastWelcomeAtMs: now,
    visitCount: (record?.visitCount ?? 0) + 1,
    lastPoiCount: poiCount > 0 ? poiCount : (record?.lastPoiCount ?? null),
  };
  await persist({
    cities: { ...state.cities, [id]: nextRec },
  });
}

/** Für Tests / Reset. */
export async function resetCityWelcomeState(): Promise<void> {
  await persist(emptyState());
}
