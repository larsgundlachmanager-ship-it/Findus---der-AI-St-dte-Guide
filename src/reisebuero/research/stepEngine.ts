/**
 * Sichtbare Recherche-Schritte + Live-Sparks für Yorros Reisebüro.
 * Status-Rail-Titel sind fest (RESEARCH_STATUS_RAIL) — Funnel ändert nur Status/Detail.
 */

import type { FunnelLogLine, ResearchSpark, ResearchStep } from '../types';
import { useReisebueroStore } from '../store';
import {
  onResearchStageActive,
  onResearchStageDone,
  startResearchProgress,
} from './progressController';
import {
  RESEARCH_STATUS_RAIL,
  canFinishTheaterStage,
  normalizeTheaterStage,
  theaterStageIndex,
} from './progressPace';
import { STAGE_META } from './stageMeta';

export { STAGE_META } from './stageMeta';
export { theaterChecklistFocus } from './stageMeta';
export { normalizeTheaterStage } from './progressPace';

function sid(stage: string): string {
  return `rs_${normalizeTheaterStage(stage)}`;
}

function railTitle(stage: string): string {
  const norm = normalizeTheaterStage(stage);
  const rail = RESEARCH_STATUS_RAIL.find((r) => r.stage === norm);
  return rail?.title || STAGE_META[norm]?.title || STAGE_META[stage]?.title || norm;
}

/** Furthest done/active index on the fixed Theater rail (monotonic). */
function furthestRailIndex(steps: ResearchStep[]): number {
  let max = -1;
  for (const s of steps) {
    if (s.status !== 'done' && s.status !== 'active' && s.status !== 'pivot') continue;
    max = Math.max(max, theaterStageIndex(s.stage));
  }
  return max;
}

export function emitStep(input: {
  stage: string;
  title: string;
  detail: string;
  status?: ResearchStep['status'];
  /** Ignoriert — Fortschritt läuft über progressController (gelernt). */
  progress?: number;
  emoji?: string;
}): void {
  const stage = normalizeTheaterStage(input.stage);
  const store = useReisebueroStore.getState();
  const idx = theaterStageIndex(stage);
  const furthest = furthestRailIndex(store.trip.researchSteps);
  // Kein Zurückspulen: ältere Theater-Stages nicht wieder active machen
  if (idx >= 0 && furthest >= 0 && idx < furthest) {
    const cur = store.trip.researchSteps.find((s) => s.status === 'active');
    if (cur) {
      store.upsertResearchStep({
        ...cur,
        detail: input.detail || cur.detail,
      });
    }
    return;
  }
  const meta = STAGE_META[stage] || STAGE_META[input.stage];
  const prev = store.trip.researchSteps.find((s) => s.id === sid(stage));
  if (prev?.status === 'done' && idx === furthest) {
    // schon fertig — nur Detail auffrischen, nicht reaktivieren
    store.upsertResearchStep({
      ...prev,
      detail: input.detail || prev.detail,
    });
    return;
  }
  const nextSteps = store.trip.researchSteps.map((s) => {
    if (s.stage === stage) {
      return {
        id: sid(stage),
        stage,
        title: prev?.title || railTitle(stage),
        detail: input.detail,
        status: input.status ?? ('active' as ResearchStep['status']),
        emoji: input.emoji || prev?.emoji || meta?.emoji || '🔎',
      };
    }
    if (s.status === 'active') return { ...s, status: 'pending' as ResearchStep['status'] };
    return s;
  });
  if (!nextSteps.some((s) => s.stage === stage)) {
    nextSteps.push({
      id: sid(stage),
      stage,
      title: railTitle(stage),
      detail: input.detail,
      status: input.status ?? 'active',
      emoji: input.emoji || meta?.emoji || '🔎',
    });
  }
  store.setResearchSteps(nextSteps);
  onResearchStageActive(stage);
}

export function finishStep(stageRaw: string, detail?: string): void {
  const stage = normalizeTheaterStage(stageRaw);
  const store = useReisebueroStore.getState();
  const prev = store.trip.researchSteps.find((s) => s.id === sid(stage));
  const meta = STAGE_META[stage] || STAGE_META[stageRaw];
  if (!canFinishTheaterStage(stageRaw, stage)) {
    if (prev && (prev.status === 'active' || prev.status === 'pivot')) {
      store.upsertResearchStep({
        ...prev,
        detail: detail || prev.detail,
      });
    }
    return;
  }
  store.upsertResearchStep({
    id: sid(stage),
    stage,
    title: prev?.title || railTitle(stage),
    detail: detail || prev?.detail || '',
    status: 'done',
    emoji: prev?.emoji || meta?.emoji || '✓',
  });
  onResearchStageDone(stage);
}

export function pivotStep(stageRaw: string, detail: string): void {
  const stage = normalizeTheaterStage(stageRaw);
  const store = useReisebueroStore.getState();
  const prev = store.trip.researchSteps.find((s) => s.id === sid(stage));
  store.upsertResearchStep({
    id: sid(stage),
    stage,
    title: prev?.title || railTitle(stage),
    detail,
    status: 'pivot',
    emoji: '🔄',
  });
  store.appendDecision(stage, detail);
  onResearchStageActive(stage);
}

export function emitSpark(
  input: Omit<ResearchSpark, 'id' | 'atMs'> & { id?: string },
): void {
  useReisebueroStore.getState().pushResearchSpark(input);
}

export function logToSteps(log: FunnelLogLine[]): void {
  for (const line of log) {
    finishStep(line.stage, line.detail);
  }
}

/** Feste Status-Rail — Titel/Reihenfolge ändern sich nie während einer Recherche. */
export const RESEARCH_SCRIPT = RESEARCH_STATUS_RAIL.map((r) => ({
  stage: r.stage,
  title: r.title,
  detail: STAGE_META[r.stage]?.vibe || r.title,
}));

export function seedResearchTheater(opts?: { path?: string | null }): void {
  const store = useReisebueroStore.getState();
  store.clearResearchSparks();
  store.setResearchEtaMin(null);
  store.setResearchSteps(
    RESEARCH_SCRIPT.map((s, i) => {
      const meta = STAGE_META[s.stage];
      return {
        id: sid(s.stage),
        stage: s.stage,
        title: s.title,
        detail: s.detail,
        status: (i === 0 ? 'active' : 'pending') as ResearchStep['status'],
        emoji: meta?.emoji || '🔎',
      };
    }),
  );
  store.pushResearchSpark({
    kind: 'vibe',
    emoji: '🔎',
    label: 'Ich such los',
    sub: 'Brief-Plan zuerst',
  });
  startResearchProgress({ path: opts?.path || 'default' });
}

export function placeSparkEmoji(tags: string[], placeName?: string): string {
  if (tags.some((t) => /deal|bargain/i.test(t))) return '🔥';
  if (tags.some((t) => /exclusive/i.test(t))) return '✨';
  if (tags.some((t) => /geheim|scenic|lonely/i.test(t))) return '💎';
  if (tags.includes('party')) return '🎉';
  if (tags.includes('spa')) return '🧖';
  if (tags.includes('sea') || tags.includes('sand')) return '🏖️';
  if (tags.includes('city')) return '🏙️';
  if (tags.includes('warm')) return '☀️';
  if (placeName) {
    try {
      const { emojiForWishText } = require('../flipchartNotes') as typeof import('../flipchartNotes');
      const e = emojiForWishText(placeName, '🏙️');
      if (e && e !== '📌' && e !== '📍') return e;
    } catch {
      /* soft */
    }
  }
  return '🏙️';
}
