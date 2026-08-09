/**
 * Fact-Lane: 1h-Tour / unbesuchte Sights — Pack first, Prefs filtern.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { hasVisitedSpot } from '../../runtime/triggerEngine';
import { getCachedUserProfile } from '../../services/userProfileService';
import type { AgentResult, Module2ActionButton } from '../types';

export function isHourTourQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(eine\s+stunde|1\s*h|60\s*min|kurz\s+tour|noch\s+nicht\s+gesehen)\b/iu.test(t)) {
    return true;
  }
  if (
    /\b(was\s+haben\s+wir|was\s+fehlt|unbesucht|noch\s+nicht)\b/iu.test(t) &&
    /\b(gesehen|besucht|geschafft)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

function preferHafenEnd(text: string): boolean {
  return /\b(hafen|hafenpromenade)\b/iu.test(text);
}

function skipMuseum(profile: ReturnType<typeof getCachedUserProfile>): boolean {
  try {
    const blob = JSON.stringify(profile ?? {}).toLowerCase();
    if (/museum/.test(blob) && /\b(skip|nein|no|avoid)\b/.test(blob)) {
      return true;
    }
    const { resolvePersonaEngine } = require('../../services/personaEngine') as {
      resolvePersonaEngine: (p: unknown) => {
        preferences?: { skipCategories?: string[] };
      };
    };
    const skip = resolvePersonaEngine(profile)?.preferences?.skipCategories ?? [];
    return skip.some((c) => /museum/i.test(c));
  } catch {
    return false;
  }
}

export async function researchHourTour(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
}): Promise<AgentResult> {
  const profile = getCachedUserProfile();
  const dropMuseum = skipMuseum(profile);
  const wantHafen = preferHafenEnd(opts.userText);
  const radiusM = 2_500;

  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    pois = [];
  }

  type Hit = {
    name: string;
    lat: number;
    lng: number;
    distanceM: number;
    category: string;
    spotKey: string | null;
  };

  const candidates: Hit[] = [];
  for (const p of pois) {
    if (p.kind === 'approach' || p.kind === 'sub') continue;
    const cat = (p.category || '').toLowerCase();
    const tags = parseTagsJson(p.tags_json).join(' ').toLowerCase();
    const blob = `${p.name} ${cat} ${tags}`;
    if (/hotel|restaurant|café|cafe|supermarket|tankstelle|toilet/i.test(blob)) {
      continue;
    }
    if (dropMuseum && /museum|galerie/i.test(blob)) continue;
    if (!/denkmal|museum|hafen|kirche|strand|promenade|park|aussicht|turm|bucht|mole|leuchtturm|sehens/i.test(blob) &&
        !/sight|attraction|landmark/i.test(cat)) {
      // Directory-Noise raus, außer klare Sight-Keywords im Namen
      if (!/\b(denkmal|museum|kirche|hafen|turm|promenade)\b/i.test(p.name)) {
        continue;
      }
    }
    const d = haversineMeters(opts.lat, opts.lng, p.lat, p.lng);
    if (d > radiusM) continue;
    const spotKey = p.spot_key ?? null;
    if (spotKey && hasVisitedSpot(spotKey)) continue;
    candidates.push({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      distanceM: Math.round(d),
      category: cat || 'sight',
      spotKey,
    });
  }
  candidates.sort((a, b) => a.distanceM - b.distanceM);

  let picks = candidates.slice(0, 4);
  if (wantHafen) {
    const hafen = candidates.find((c) => /hafen/i.test(c.name + c.category));
    if (hafen) {
      picks = [
        ...picks.filter((p) => p.name !== hafen.name).slice(0, 2),
        hafen,
      ];
    }
  }
  picks = picks.slice(0, 3);

  if (!picks.length) {
    return {
      agent: 'knowledge',
      ok: true,
      draftText:
        'In Laufweite (~2,5 km) finde ich gerade keine klar unbesuchten Sight-Pack-Treffer. Sag einen Stadtteil — oder wir öffnen eine kurze Explore-Route zum Hafen.',
      bullets: ['Keine unbesuchten Pack-Sights nah'],
      buttons: [],
      meta: {
        hourTour: true,
        concrete_place: false,
        venue_options: false,
      },
    };
  }

  const buttons: Module2ActionButton[] = picks.map((p, i) => ({
    id: `tour_${i}`,
    label: shorten(`📍 ${p.name}`),
    payload: {
      kind: 'navigate',
      lat: p.lat,
      lng: p.lng,
      label: p.name,
    },
  }));

  const list = picks
    .map((p, i) => `${i + 1}) ${p.name} (~${p.distanceM} m)`)
    .join('; ');
  const draft =
    `Zeitbudget ~1 Stunde — unbesucht in der Nähe: ${list}. ` +
    (wantHafen
      ? 'Abschluss Richtung Hafen mitgedacht (Parkplatz dort oft mit dabei). '
      : '') +
    (dropMuseum ? 'Museen nach Prefs ausgeblendet. ' : '') +
    'Mehrere Stopps möglich — tippe die Route oder sag wohin zuerst.';

  return {
    agent: 'knowledge',
    ok: true,
    draftText: draft,
    bullets: picks.map((p) => `${p.name} · ${p.distanceM} m`).slice(0, 3),
    buttons: buttons.slice(0, 4),
    meta: {
      hourTour: true,
      concrete_place: true,
      venue_options: picks.length >= 2,
      placeName: picks[0]!.name,
      placeLat: picks[0]!.lat,
      placeLng: picks[0]!.lng,
      distanceM: picks[0]!.distanceM,
      venues: picks.map((p) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
      })),
    },
  };
}

function shorten(s: string): string {
  const t = s.trim();
  if (t.length <= 20) return t;
  return `${t.slice(0, 18)}…`;
}
