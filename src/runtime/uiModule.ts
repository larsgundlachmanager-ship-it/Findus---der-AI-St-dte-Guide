/**
 * Modul UI (Phase 8) — HUD snapshot + Fog-of-War / Nav-Board helpers.
 */

import { getGpsStreamProfile } from '../services/locationService';
import { getCurrentTransportMode } from '../services/navigation/navigationService';
import { useFinnusStore } from '../store/useFinnusStore';
import type { FindusPresence } from '../store/useFinnusStore';
import { getRuntimeContext } from './orchestrator';
import { getGrowthSnapshot } from './growthModule';
import type { RuntimeModule } from './types';

export type HudRuntimeSnapshot = {
  runtimeModule: RuntimeModule;
  runtimeModuleLabel: string;
  presence: FindusPresence;
  presenceHint: string | null;
  queuedGpsPoiId: number | null;
  isSpeaking: boolean;
  isListening: boolean;
  isGenerating: boolean;
  navActive: boolean;
  gpsProfile: string;
  transportMode: string;
  online: boolean;
  growthPullImported: number;
  growthSyncHour: number;
};

const MODULE_LABELS: Record<RuntimeModule, string> = {
  explore: 'Erkunden',
  questions: 'Fragen',
  navigation: 'Navigation',
  idle: 'Bereit',
};

export function runtimeModuleLabel(module: RuntimeModule): string {
  return MODULE_LABELS[module] ?? module;
}

export function presenceHint(presence: FindusPresence): string | null {
  if (presence === 'offline') return 'Offline — gespeicherte Infos';
  if (presence === 'degraded') return 'Eingeschränkt — langsamer';
  return null;
}

/** Live HUD + Runtime state for Header / Dev-Board. */
export function getHudRuntimeSnapshot(): HudRuntimeSnapshot {
  const ctx = getRuntimeContext();
  const store = useFinnusStore.getState();
  const growth = getGrowthSnapshot();
  return {
    runtimeModule: ctx.module,
    runtimeModuleLabel: runtimeModuleLabel(ctx.module),
    presence: store.findusPresence,
    presenceHint: presenceHint(store.findusPresence),
    queuedGpsPoiId: ctx.queuedGpsTriggerId,
    isSpeaking: ctx.isSpeaking,
    isListening: ctx.isListening,
    isGenerating: ctx.isGenerating,
    navActive: ctx.navActive,
    gpsProfile: getGpsStreamProfile(),
    transportMode: getCurrentTransportMode(),
    online: ctx.online,
    growthPullImported: growth.lastPullImported,
    growthSyncHour: growth.syncHourLocal,
  };
}

/** Case-insensitive name filter for map + stamp list. */
export function filterItemsBySearch<T extends { name: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}
