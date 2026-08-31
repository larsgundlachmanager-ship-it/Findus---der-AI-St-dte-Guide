/**
 * Persistente API-Kosten: gesamt seit Installation, heute, letzte & aktuelle Session.
 * Tester-Anzeige = konservative Listenpreise (Obergrenze).
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';
import {
  COST_MODULE_LABELS,
  geminiEur,
  mapsEur,
  ttsEur,
  type CostModuleId,
  type GeminiCostTier,
} from './costRates';

const STORAGE_PATH = `${FileSystem.documentDirectory}api-cost-ledger-v1.json`;
const MAX_EVENTS = 80;

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
  conservativeEur: number;
  efficientEur: number;
};

export type UsageCostSlice = {
  gemini: UsageBucket;
  maps: UsageBucket;
  tts: UsageBucket;
  breakdown: CostBreakdown;
  sessionMinutes?: number;
  endedAt?: string;
};

export type CostModuleSlice = {
  id: CostModuleId;
  label: string;
  requests: number;
  conservativeEur: number;
};

export type CostEvent = {
  atMs: number;
  module: CostModuleId;
  kind: 'gemini' | 'maps' | 'tts';
  label: string;
  conservativeEur: number;
  charsIn: number;
  charsOut: number;
};

export type TodayCostReason = {
  label: string;
  detail: string;
  eur: number;
};

export type CostOverview = {
  installedAt: string;
  lifetime: UsageCostSlice;
  today: UsageCostSlice & { day: string };
  lastSession: UsageCostSlice;
  currentSession: UsageCostSlice & { startedAtMs: number };
  todayReasons: TodayCostReason[];
  todayModules: CostModuleSlice[];
  sessionModules: CostModuleSlice[];
  lastSessionModules: CostModuleSlice[];
  lifetimeModules: CostModuleSlice[];
  recentEvents: CostEvent[];
};

export type LedgerTrackMeta = {
  module?: CostModuleId;
  label?: string;
  geminiTier?: GeminiCostTier;
};

type ModuleCounts = Record<CostModuleId, { requests: number; conservativeEur: number }>;

type PersistedLedger = {
  installedAt: string;
  lifetime: UsageBucket;
  mapsLifetime: UsageBucket;
  ttsLifetime: UsageBucket;
  todayDay: string;
  todayGemini: UsageBucket;
  todayMaps: UsageBucket;
  todayTts: UsageBucket;
  todayModules: ModuleCounts;
  lifetimeModules: ModuleCounts;
  lastSession: {
    endedAt: string;
    durationMin: number;
    gemini: UsageBucket;
    maps: UsageBucket;
    tts: UsageBucket;
    modules?: ModuleCounts;
  } | null;
  recentEvents?: CostEvent[];
};

const MODULE_IDS: CostModuleId[] = [
  'nav',
  'research',
  'concierge',
  'story',
  'followup',
  'tts',
  'maps',
  'other',
];

function emptyBucket(): UsageBucket {
  return { requests: 0, charsIn: 0, charsOut: 0 };
}

function emptyModules(): ModuleCounts {
  const out = {} as ModuleCounts;
  for (const id of MODULE_IDS) {
    out[id] = { requests: 0, conservativeEur: 0 };
  }
  return out;
}

function mergeModules(raw?: Partial<ModuleCounts> | null): ModuleCounts {
  const base = emptyModules();
  if (!raw) return base;
  for (const id of MODULE_IDS) {
    const row = raw[id];
    if (!row) continue;
    base[id] = {
      requests: Math.max(0, Number(row.requests) || 0),
      conservativeEur: Math.max(0, Number(row.conservativeEur) || 0),
    };
  }
  return base;
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
  const geminiCons = geminiEur(gemini.charsIn, gemini.charsOut, 'conservative');
  const geminiEff = geminiEur(gemini.charsIn, gemini.charsOut, 'efficient');
  const mapsCons = mapsEur(maps.requests, 'conservative');
  const mapsEff = mapsEur(maps.requests, 'efficient');
  const ttsCons = ttsEur(tts.charsOut, 'conservative');
  const ttsEff = ttsEur(tts.charsOut, 'efficient');
  return {
    geminiEur: geminiCons,
    mapsEur: mapsCons,
    ttsEur: ttsCons,
    totalEur: geminiCons + mapsCons + ttsCons,
    conservativeEur: geminiCons + mapsCons + ttsCons,
    efficientEur: geminiEff + mapsEff + ttsEff,
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

function modulesToSlices(mods: ModuleCounts): CostModuleSlice[] {
  return MODULE_IDS.map((id) => ({
    id,
    label: COST_MODULE_LABELS[id],
    requests: mods[id]?.requests ?? 0,
    conservativeEur: mods[id]?.conservativeEur ?? 0,
  }))
    .filter((m) => m.requests > 0 || m.conservativeEur > 0.00005)
    .sort((a, b) => b.conservativeEur - a.conservativeEur);
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
  todayModules: emptyModules(),
  lifetimeModules: emptyModules(),
  lastSession: null,
};

const session = {
  startedAtMs: Date.now(),
  gemini: emptyBucket(),
  maps: emptyBucket(),
  tts: emptyBucket(),
  modules: emptyModules(),
};

const recentEvents: CostEvent[] = [];

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
    persisted.todayModules = emptyModules();
  }
}

function bumpBucket(bucket: UsageBucket, charsIn: number, charsOut: number): void {
  bucket.requests += 1;
  bucket.charsIn += Math.max(0, charsIn);
  bucket.charsOut += Math.max(0, charsOut);
}

function bumpModule(mods: ModuleCounts, id: CostModuleId, eur: number): void {
  const row = mods[id] ?? { requests: 0, conservativeEur: 0 };
  row.requests += 1;
  row.conservativeEur += Math.max(0, eur);
  mods[id] = row;
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
          persisted.todayModules = mergeModules(parsed.todayModules);
          persisted.lifetimeModules = mergeModules(parsed.lifetimeModules);
          persisted.lastSession = parsed.lastSession ?? null;
          if (Array.isArray(parsed.recentEvents)) {
            recentEvents.length = 0;
            for (const ev of parsed.recentEvents.slice(0, MAX_EVENTS)) {
              if (!ev || typeof ev !== 'object') continue;
              recentEvents.push(ev as CostEvent);
            }
          }
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

function conservativeFor(
  kind: 'gemini' | 'maps' | 'tts',
  charsIn: number,
  charsOut: number,
  geminiTier: GeminiCostTier = 'lite',
): number {
  if (kind === 'gemini') {
    return geminiEur(charsIn, charsOut, 'conservative', geminiTier);
  }
  if (kind === 'maps') return mapsEur(1, 'conservative');
  return ttsEur(charsOut, 'conservative');
}

function defaultModule(kind: 'gemini' | 'maps' | 'tts'): CostModuleId {
  if (kind === 'maps') return 'maps';
  if (kind === 'tts') return 'tts';
  return 'other';
}

function recordUsage(
  kind: 'gemini' | 'maps' | 'tts',
  charsIn: number,
  charsOut: number,
  meta?: LedgerTrackMeta,
): void {
  ensureToday();
  const bump = (b: UsageBucket) => bumpBucket(b, charsIn, charsOut);
  const module = meta?.module ?? defaultModule(kind);
  const eur = conservativeFor(kind, charsIn, charsOut, meta?.geminiTier);

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

  bumpModule(session.modules, module, eur);
  bumpModule(persisted.todayModules, module, eur);
  bumpModule(persisted.lifetimeModules, module, eur);

  recentEvents.unshift({
    atMs: Date.now(),
    module,
    kind,
    label: (meta?.label || COST_MODULE_LABELS[module]).slice(0, 80),
    conservativeEur: eur,
    charsIn: Math.max(0, charsIn),
    charsOut: Math.max(0, charsOut),
  });
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
  persisted.recentEvents = recentEvents.slice(0, 40);

  schedulePersist();
  void hydrate();
}

export function bootstrapApiCostLedger(): () => void {
  void hydrate();

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        finalizeCurrentSession();
        void import('./deviceCostUpload')
          .then((m) => m.uploadDeviceCostDay())
          .catch(() => undefined);
      }
    });
  }

  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}

export function trackLedgerGemini(
  charsIn: number,
  charsOut: number,
  meta?: LedgerTrackMeta,
): void {
  recordUsage('gemini', charsIn, charsOut, meta);
}

export function trackLedgerMaps(label = 'maps', module: CostModuleId = 'maps'): void {
  recordUsage('maps', label.length, 0, { module, label });
}

export function trackLedgerTts(
  chars: number,
  cloud = false,
  meta?: LedgerTrackMeta,
): void {
  if (!cloud) {
    recordUsage('tts', chars, 0, { ...meta, module: meta?.module ?? 'tts' });
    return;
  }
  recordUsage('tts', chars, chars, { ...meta, module: meta?.module ?? 'tts' });
}

export function finalizeCurrentSession(): void {
  const durationMin = Math.max(
    0,
    Math.round((Date.now() - session.startedAtMs) / 60_000),
  );
  const hasUsage =
    session.gemini.requests + session.maps.requests + session.tts.requests > 0;
  if (!hasUsage) return;

  persisted.lastSession = {
    endedAt: new Date().toISOString(),
    durationMin,
    gemini: { ...session.gemini },
    maps: { ...session.maps },
    tts: { ...session.tts },
    modules: { ...session.modules },
  };
  schedulePersist();
}

function buildTodayReasons(today: UsageCostSlice): TodayCostReason[] {
  const reasons: TodayCostReason[] = [];
  const { gemini, maps, tts, breakdown } = today;

  if (breakdown.geminiEur >= 0.0001) {
    reasons.push({
      label: 'Gemini (KI)',
      detail: `${gemini.requests} Anfragen · ${gemini.charsIn.toLocaleString('de-DE')} Zeichen rein · ${gemini.charsOut.toLocaleString('de-DE')} raus — Obergrenze Pro-Listenpreis`,
      eur: breakdown.geminiEur,
    });
  }
  if (breakdown.mapsEur >= 0.0001) {
    reasons.push({
      label: 'Google Maps',
      detail: `${maps.requests} API-Calls — Places / Directions / Geocode (OSM zählt nicht)`,
      eur: breakdown.mapsEur,
    });
  }
  if (breakdown.ttsEur >= 0.0001) {
    reasons.push({
      label: 'Cartesia (TTS)',
      detail: `${tts.requests} Cloud-Calls · ${tts.charsOut.toLocaleString('de-DE')} Zeichen — nur echte Synthese, Cache ist gratis`,
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
    ...sliceFrom(persisted.todayGemini, persisted.todayMaps, persisted.todayTts),
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
    todayModules: modulesToSlices(persisted.todayModules),
    sessionModules: modulesToSlices(session.modules),
    lastSessionModules: modulesToSlices(
      mergeModules(persisted.lastSession?.modules),
    ),
    lifetimeModules: modulesToSlices(persisted.lifetimeModules),
    recentEvents: recentEvents.slice(0, 24),
  };
}

export async function getCostOverviewAsync(): Promise<CostOverview> {
  await hydrate();
  return getCostOverview();
}

export function getTodayCostUploadPayload(): {
  day: string;
  conservativeEur: number;
  efficientEur: number;
  geminiRequests: number;
  mapsRequests: number;
  ttsChars: number;
  modules: ModuleCounts;
} {
  ensureToday();
  const today = sliceFrom(
    persisted.todayGemini,
    persisted.todayMaps,
    persisted.todayTts,
  );
  return {
    day: persisted.todayDay,
    conservativeEur: today.breakdown.conservativeEur,
    efficientEur: today.breakdown.efficientEur,
    geminiRequests: persisted.todayGemini.requests,
    mapsRequests: persisted.todayMaps.requests,
    ttsChars: persisted.todayTts.charsOut,
    modules: persisted.todayModules,
  };
}

export function resetCurrentSessionUsage(): void {
  session.startedAtMs = Date.now();
  session.gemini = emptyBucket();
  session.maps = emptyBucket();
  session.tts = emptyBucket();
  session.modules = emptyModules();
  recentEvents.length = 0;
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
  persisted.todayModules = emptyModules();
  persisted.lifetimeModules = emptyModules();
  persisted.lastSession = null;
  resetCurrentSessionUsage();
  schedulePersist();
}

export function formatCostEur(eur: number): string {
  if (eur < 0.0001) return '< 0,01 €';
  if (eur < 0.01) return `${eur.toFixed(3).replace('.', ',')} €`;
  return `${eur.toFixed(2).replace('.', ',')} €`;
}
