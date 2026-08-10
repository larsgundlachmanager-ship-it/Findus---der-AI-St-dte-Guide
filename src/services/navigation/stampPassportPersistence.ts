/**
 * Persistente Stempelkarte — besuchte Orte über App-Neustarts hinweg.
 */

import * as FileSystem from 'expo-file-system';
import type { VisitedPlaceMemory } from '../ai/sessionMemory';
import type { PoiHookKind } from '../ai/fastHook';

const PATH = `${FileSystem.documentDirectory}findus-stamp-passport-v1.json`;
/** Langzeit — Stempel/Zeitachse nicht nach wenigen hundert Orten verwerfen */
const MAX_ENTRIES = 8_000;

function coerceEntry(raw: unknown): VisitedPlaceMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const poiId = Number(e.poiId);
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  const visitedAt = Number(e.visitedAt);
  if (!Number.isFinite(poiId) || !name || !Number.isFinite(visitedAt)) {
    return null;
  }
  const kindRaw = typeof e.kind === 'string' ? e.kind : 'generic';
  const kind = (kindRaw || 'generic') as PoiHookKind;
  const keyFacts = Array.isArray(e.keyFacts)
    ? e.keyFacts.filter((f): f is string => typeof f === 'string')
    : [];
  const onTimeline =
    typeof e.onTimeline === 'boolean' ? e.onTimeline : undefined;
  const lat = Number(e.lat);
  const lng = Number(e.lng);
  return {
    poiId,
    name,
    kind,
    keyFacts,
    visitedAt,
    onTimeline,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

export async function loadStampPassport(): Promise<VisitedPlaceMemory[]> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as { entries?: unknown[] };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .map(coerceEntry)
      .filter((e): e is VisitedPlaceMemory => e != null)
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function saveStampPassport(
  entries: VisitedPlaceMemory[],
): Promise<void> {
  const trimmed = entries.slice(-MAX_ENTRIES);
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ version: 1, entries: trimmed }),
    );
  } catch (err) {
    console.warn('[stampPassport] persist failed:', err);
  }
}

export async function clearStampPassport(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      await FileSystem.deleteAsync(PATH, { idempotent: true });
    }
  } catch {
    /* ignore */
  }
}
