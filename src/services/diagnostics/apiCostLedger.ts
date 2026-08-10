/**
 * Persistente API-Kosten: gesamt seit Installation, heute, letzte & aktuelle Session.
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';

const STORAGE_PATH = `${FileSystem.documentDirectory}api-cost-ledger-v1.json`;

/** Gemini Flash-Lite ≈ €0.10 / 1M input, €0.40 / 1M output. */
const GEMINI_IN_PER_M = 0.1;
const GEMINI_OUT_PER_M = 0.4;
/** Maps Places/Directions ≈ €0.008 / Call. */
const MAPS_PER_CALL = 0.008;
/** Cartesia sonic-3.5 ≈ €0.009 / 1k chars. */
const TTS_CLOUD_PER_1K = 0.009;

export type UsageBucket = {
  requests: number;
  charsIn: number;
  charsOut: number;
};

export type CostBreakdown = {
  geminiEur: number;
  mapsEur: number;
  ttsEur: number;
  totalEur: number;
};

export type UsageCostSlice = {
  gemini: UsageBucket;
  maps: UsageBucket;
  tts: UsageBucket;
  breakdown: CostBreakdown;
  sessionMinutes?: number;
  endedAt?: string;
};

export type CostOverview = {
  installedAt: string;
  lifetime: UsageCostSlice;
  today: UsageCostSlice & { day: string };
  lastSession: UsageCostSlice;
  currentSession: UsageCostSlice & { startedAtMs: number };
  todayReasons: TodayCostReason[];
};

export type TodayCostReason = {
  label: string;
  detail: string;
  eur: number;
};

type PersistedLedger = {
  installedAt: string;
  lifetime: UsageBucket;
  mapsLifetime: UsageBucket;
  ttsLifetime: UsageBucket;
  todayDay: string;
  todayGemini: UsageBucket;
  todayMaps: UsageBucket;
  todayTts: UsageBucket;
  lastSession: {
    endedAt: string;
    durationMin: number;
    gemini: UsageBucket;
    maps: UsageBucket;
    tts: UsageBucket;
  } | null;
};

function emptyBucket(): UsageBucket {
  return { requests: 0, charsIn: 0, charsOut: 0 };
}

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcBreakdown(
  gemini: UsageBucket,
  maps: UsageBucket,
  tts: UsageBucket,
): CostBreakdown {
  const geminiEur =
    (gemini.charsIn / 1_000_000) * GEMINI_IN_PER_M +
    (gemini.charsOut / 1_000_000) * GEMINI_OUT_PER_M;
  const mapsEur = maps.requests * MAPS_PER_CALL;
  const ttsEur = (tts.charsOut / 1000) * TTS_CLOUD_PER_1K;
  return {
    geminiEur,
    mapsEur,
    ttsEur,
    totalEur: geminiEur + mapsEur + ttsEur,
  };
}

function sliceFrom(
  gemini: UsageBucket,
  maps: UsageBucket,
  tts: UsageBucket,
  extra?: { sessionMinutes?: number; endedAt?: string },
): UsageCostSlice {
  return {
    gemini: { ...gemini },
    maps: { ...maps },
    tts: { ...tts },
    breakdown: calcBreakdown(gemini, maps, tts),
    ...extra,
  };
}

const persisted: PersistedLedger = {
  installedAt: new Date().toISOString(),
  lifetime: emptyBucket(),
  mapsLifetime: emptyBucket(),
  ttsLifetime: emptyBucket(),
  todayDay: localDayKey(),
  todayGemini: emptyBucket(),
  todayMaps: emptyBucket(),
  todayTts: emptyBucket(),
  lastSession: null,
};

const session = {
  startedAtMs: Date.now(),
  gemini: emptyBucket(),
  maps: emptyBucket(),
  tts: emptyBucket(),
};

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: NativeEventSubscription | null = null;

function ensureToday(): void {
  const today = localDayKey();
  if (persisted.todayDay !== today) {
    persisted.todayDay = today;
    persisted.todayGemini = emptyBucket();
    persisted.todayMaps = emptyBucket();
    persisted.todayTts = emptyBucket();
  }
}

function bumpBucket(bucket: UsageBucket, charsIn: number, charsOut: number): void {
  bucket.requests += 1;
  bucket.charsIn += Math.max(0, charsIn);
  bucket.charsOut += Math.max(0, charsOut);
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(STORAGE_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(STORAGE_PATH);
        const parsed = JSON.parse(raw) as Partial<PersistedLedger>;
        if (parsed && typeof parsed.installedAt === 'string') {
          persisted.installedAt = parsed.installedAt;
          persisted.lifetime = parsed.lifetime ?? emptyBucket();
          persisted.mapsLifetime = parsed.mapsLifetime ?? emptyBucket();
          persisted.ttsLifetime = parsed.ttsLifetime ?? emptyBucket();
          persisted.todayDay = parsed.todayDay ?? localDayKey();
          persisted.todayGemini = parsed.todayGemini ?? emptyBucket();
          persisted.todayMaps = parsed.todayMaps ?? emptyBucket();
          persisted.todayTts = parsed.todayTts ?? emptyBucket();
          persisted.lastSession = parsed.lastSession ?? null;
        }
      }
    } catch {
      /* ignore corrupt file */
    } finally {
      ensureToday();
      hydrated = true;
    }
  })();
  return hydratePromise;
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void FileSystem.writeAsStringAsync(
      STORAGE_PATH,
      JSON.stringify(persisted),
    ).catch(() => undefined);
  }, 400);
}

function recordUsage(
  kind: 'gemini' | 'maps' | 'tts',
  charsIn: number,
  charsOut: number,
): void {
  ensureToday();
  const bump = (b: UsageBucket) => bumpBucket(b, charsIn, charsOut);

  if (kind === 'gemini') {
    bump(session.gemini);
    bump(persisted.lifetime);
    bump(persisted.todayGemini);
  } else if (kind === 'maps') {
    bump(session.maps);
    bump(persisted.mapsLifetime);
    bump(persisted.todayMaps);
  } else {
    bump(session.tts);
    bump(persisted.ttsLifetime);
    bump(persisted.todayTts);
  }
  schedulePersist();
  void hydrate();
}

export function bootstrapApiCostLedger(): () => void {
  void hydrate();

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        finalizeCurrentSession();
      }
    });
  }

  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}

export function trackLedgerGemini(charsIn: number, charsOut: number): void {
  recordUsage('gemini', charsIn, charsOut);
}

export function trackLedgerMaps(label = 'maps'): void {
  recordUsage('maps', label.length, 0);
}

export function trackLedgerTts(chars: number, cloud = false): void {
  if (!cloud) {
    recordUsage('tts', chars, 0);
    return;
  }
  recordUsage('tts', chars, chars);
}

export function finalizeCurrentSession(): void {
  const durationMin = Math.max(
    0,
    Math.round((Date.now() - session.startedAtMs) / 60_000),
  );
  const hasUsage =
    session.gemini.requests +
      session.maps.requests +
      session.tts.requests >
    0;
  if (!hasUsage) return;

  persisted.lastSession = {
    endedAt: new Date().toISOString(),
    durationMin,
    gemini: { ...session.gemini },
    maps: { ...session.maps },
    tts: { ...session.tts },
  };
  schedulePersist();
}

function buildTodayReasons(today: UsageCostSlice): TodayCostReason[] {
  const reasons: TodayCostReason[] = [];
  const { gemini, maps, tts, breakdown } = today;

  if (breakdown.geminiEur >= 0.0001) {
    reasons.push({
      label: 'Gemini (KI)',
      detail: `${gemini.requests} Anfragen · ${gemini.charsIn.toLocaleString('de-DE')} Zeichen rein · ${gemini.charsOut.toLocaleString('de-DE')} raus — Stories, Antworten, Concierge`,
      eur: breakdown.geminiEur,
    });
  }
  if (breakdown.mapsEur >= 0.0001) {
    reasons.push({
      label: 'Google Maps',
      detail: `${maps.requests} API-Calls — Navigation, Orte, Geocoding`,
      eur: breakdown.mapsEur,
    });
  }
  if (breakdown.ttsEur >= 0.0001) {
    reasons.push({
      label: 'Cartesia (TTS)',
      detail: `${tts.requests} Sprachausgaben · ${tts.charsOut.toLocaleString('de-DE')} Zeichen — Findus-Stimme live`,
      eur: breakdown.ttsEur,
    });
  }
  if (reasons.length === 0) {
    reasons.push({
      label: 'Noch keine Kosten heute',
      detail: 'Sobald KI, Maps oder TTS genutzt werden, siehst du hier die Aufschlüsselung.',
      eur: 0,
    });
  }
  reasons.sort((a, b) => b.eur - a.eur);
  return reasons;
}

export function getCostOverview(): CostOverview {
  ensureToday();
  const lifetime = sliceFrom(
    persisted.lifetime,
    persisted.mapsLifetime,
    persisted.ttsLifetime,
  );
  const today = {
    day: persisted.todayDay,
    ...sliceFrom(
      persisted.todayGemini,
      persisted.todayMaps,
      persisted.todayTts,
    ),
  };
  const lastSession = persisted.lastSession
    ? sliceFrom(
        persisted.lastSession.gemini,
        persisted.lastSession.maps,
        persisted.lastSession.tts,
        {
          sessionMinutes: persisted.lastSession.durationMin,
          endedAt: persisted.lastSession.endedAt,
        },
      )
    : sliceFrom(emptyBucket(), emptyBucket(), emptyBucket(), {
        sessionMinutes: 0,
      });

  const currentSession = {
    startedAtMs: session.startedAtMs,
    ...sliceFrom(session.gemini, session.maps, session.tts, {
      sessionMinutes: Math.max(
        0,
        Math.round((Date.now() - session.startedAtMs) / 60_000),
      ),
    }),
  };

  return {
    installedAt: persisted.installedAt,
    lifetime,
    today,
    lastSession,
    currentSession,
    todayReasons: buildTodayReasons(today),
  };
}

export async function getCostOverviewAsync(): Promise<CostOverview> {
  await hydrate();
  return getCostOverview();
}

export function resetCurrentSessionUsage(): void {
  session.startedAtMs = Date.now();
  session.gemini = emptyBucket();
  session.maps = emptyBucket();
  session.tts = emptyBucket();
}

export async function resetAllCostLedger(): Promise<void> {
  await hydrate();
  persisted.installedAt = new Date().toISOString();
  persisted.lifetime = emptyBucket();
  persisted.mapsLifetime = emptyBucket();
  persisted.ttsLifetime = emptyBucket();
  persisted.todayDay = localDayKey();
  persisted.todayGemini = emptyBucket();
  persisted.todayMaps = emptyBucket();
  persisted.todayTts = emptyBucket();
  persisted.lastSession = null;
  resetCurrentSessionUsage();
  schedulePersist();
}

export function formatCostEur(eur: number): string {
  if (eur < 0.0001) return '< 0,01 €';
  if (eur < 0.01) return `${eur.toFixed(3).replace('.', ',')} €`;
  return `${eur.toFixed(2).replace('.', ',')} €`;
}
