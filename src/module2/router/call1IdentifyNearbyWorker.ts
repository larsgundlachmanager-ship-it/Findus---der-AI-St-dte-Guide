/**
 * Identify-Nearby Worker — „Was ist das?“ / „Wo bin ich?“
 * SSOT: researchPackMatchStory (Pack + GPS), kein Nav-Start.
 */

import type { Module2ActionButton } from '../types';

export type IdentifyNearbyResult = {
  ok: boolean;
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  promptBlock: string;
  placeName?: string | null;
};

export function wantsIdentifyNearby(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { isDeicticPoiQuestion } = require('../../services/intent/poiInfoVsNav') as {
      isDeicticPoiQuestion: (s: string) => boolean;
    };
    if (isDeicticPoiQuestion(t)) return true;
  } catch {
    /* soft */
  }
  try {
    const { looksLikeWhereAmIQuery } = require('../kernel/turnKernel') as {
      looksLikeWhereAmIQuery: (s: string) => boolean;
    };
    if (looksLikeWhereAmIQuery(t)) return true;
  } catch {
    /* soft */
  }
  return /\b(was\s+sehe\s+ich\s+(?:da|hier)|was\s+ist\s+das\s+für\s+ein\s+(?:turm|gebäude|denkmal)|wo\s+stehe\s+ich)\b/iu.test(
    t,
  );
}

function gpsFromRucksack(rucksack?: {
  gpsHistory?: Array<{ lat: number; lng: number }>;
} | null): { lat: number; lng: number } | null {
  const pts = rucksack?.gpsHistory ?? [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (
      p &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lat) > 0.01 &&
      Math.abs(p.lng) > 0.01
    ) {
      return { lat: p.lat, lng: p.lng };
    }
  }
  return null;
}

export async function researchIdentifyNearby(opts: {
  userText: string;
  cityHint?: string | null;
  lat?: number | null;
  lng?: number | null;
  rucksack?: { gpsHistory?: Array<{ lat: number; lng: number }> } | null;
  signal?: AbortSignal;
}): Promise<IdentifyNearbyResult> {
  if (opts.signal?.aborted) {
    return {
      ok: false,
      spokenDraft:
        'FAKTEN Identify-Nearby: abgebrochen.\nFLOW: ehrlich kurz — kein Fake-Ort.',
      bullets: [],
      buttons: [],
      promptBlock: 'Identify aborted',
    };
  }

  const gps =
    opts.lat != null &&
    opts.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
      ? { lat: opts.lat, lng: opts.lng }
      : gpsFromRucksack(opts.rucksack);

  if (!gps) {
    const spokenDraft = [
      'FAKTEN Identify-Nearby: kein Live-GPS.',
      'FLOW: ehrlich fragen ob User noch am letzten Ort / kurz ins Freie gehen — keinen Ort erfinden.',
    ].join('\n');
    return {
      ok: false,
      spokenDraft,
      bullets: ['Kein GPS'],
      buttons: [],
      promptBlock: spokenDraft,
    };
  }

  try {
    const { researchPackMatchStory } = require('../reboot/packMatchFacts') as {
      researchPackMatchStory: (o: {
        userText: string;
        lat: number;
        lng: number;
        cityHint?: string | null;
      }) => Promise<{
        ok: boolean;
        draftText: string;
        bullets?: string[];
        buttons?: Module2ActionButton[];
        meta?: { concrete_place?: boolean };
      }>;
    };
    const hit = await researchPackMatchStory({
      userText: opts.userText,
      lat: gps.lat,
      lng: gps.lng,
      cityHint: opts.cityHint,
    });
    const placeName = hit.bullets?.[0] ?? null;
    return {
      ok: Boolean(hit.meta?.concrete_place ?? hit.ok),
      spokenDraft: hit.draftText,
      bullets: (hit.bullets ?? []).slice(0, 3),
      buttons: hit.buttons ?? [],
      promptBlock: hit.draftText,
      placeName,
    };
  } catch {
    const spokenDraft = [
      'FAKTEN Identify-Nearby: Pack-Lookup fehlgeschlagen.',
      'FLOW: ehrlich — Ort kurz beschreiben lassen oder Live-Recherche anbieten. Nichts erfinden.',
    ].join('\n');
    return {
      ok: false,
      spokenDraft,
      bullets: [],
      buttons: [],
      promptBlock: spokenDraft,
    };
  }
}
