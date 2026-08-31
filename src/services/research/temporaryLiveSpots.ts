/**
 * Temporäre Live-Orte / Events — nur mit Beleg-URL + geprüfter Nähe.
 * Ambient-Pitch: Zielgruppen-Fit (Alter, Reisegruppe, gelernte Skips).
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { FINDUS_FEW_SHOT_DISCLAIMER, FINDUS_WOVEN_PITCH_SPEECH_BLOCK } from '../concierge/findusResponsePolicy';
import { formatTemporaryLiveSpeech, isUpcomingForUnsolicitedPitch } from '../speech/laterPlanSpeech';
import { haversineMeters } from '../../db/database';
import type { TravelParty } from '../../types/userProfile';
import {
  inferAudienceTags,
  spotFitsUserAudience,
} from './eventAudienceFit';

export type TemporaryLiveSpot = {
  name: string;
  kindHint: string;
  whenLabel: string;
  distanceHintM: number | null;
  hook: string;
  sourceUrl: string | null;
  /** Geschätzte Zielgruppe vom Research */
  audienceTags?: string[];
  audienceMinAge?: number | null;
  audienceMaxAge?: number | null;
  venueLat?: number | null;
  venueLng?: number | null;
};

export type TemporaryLiveUserCtx = {
  age: number;
  travelParty?: TravelParty | null;
  nightlifeOk?: boolean;
  aboutMe?: string | null;
  softSkipTags?: string[];
};

export { spotFitsUserAudience, inferAudienceTags } from './eventAudienceFit';

const DEFAULT_NEAR_M = 5_000;

function resolveAgeBandLocal(
  age: number,
): 'child' | 'teen' | 'young' | 'adult' | 'senior' {
  if (!Number.isFinite(age) || age < 1) return 'adult';
  if (age < 12) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'young';
  if (age < 60) return 'adult';
  return 'senior';
}

function extractJsonArray(raw: string): unknown[] | null {
  const t = (raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Werbe-/Behörden-Hooks nicht vorlesen. */
export function isBrochureHook(hook: string): boolean {
  const t = hook.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  return (
    /\b(genieße|erlesene|frische\s+regionale|kulinarische\s+vielfalt|einzigartige\s+atmosphäre|lassen\s+sie\s+sich|beeindrucken\s+sie|laden\s+sie\s+ein)\b/iu.test(
      t,
    ) ||
    /^genieß/iu.test(t) ||
    /\b(Sie|Ihnen)\b/.test(t)
  );
}

/**
 * Echte Distanz zum Venue (Places und/oder Gemini-Koordinaten).
 */
export async function verifyTemporaryLiveDistanceM(opts: {
  name: string;
  lat: number;
  lng: number;
  maxM?: number;
  venueLat?: number | null;
  venueLng?: number | null;
}): Promise<number | null> {
  const maxM = opts.maxM ?? DEFAULT_NEAR_M;
  if (
    opts.venueLat != null &&
    opts.venueLng != null &&
    Number.isFinite(opts.venueLat) &&
    Number.isFinite(opts.venueLng)
  ) {
    const d = haversineMeters(
      opts.lat,
      opts.lng,
      opts.venueLat,
      opts.venueLng,
    );
    if (Number.isFinite(d) && d <= maxM) return Math.round(d);
  }

  const q = opts.name.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  try {
    const { searchPlacesByText } = await import('../navigation/googleMapsNav');
    const hits = await searchPlacesByText({
      query: q,
      lat: opts.lat,
      lng: opts.lng,
      radiusM: Math.max(1200, Math.min(maxM * 1.2, 8_000)),
    });
    let best: number | null = null;
    for (const h of hits.slice(0, 6)) {
      if (h.lat == null || h.lng == null) continue;
      const d = haversineMeters(opts.lat, opts.lng, h.lat, h.lng);
      if (!Number.isFinite(d)) continue;
      if (best == null || d < best) best = Math.round(d);
    }
    return best != null && best <= maxM ? best : null;
  } catch {
    return null;
  }
}

/**
 * Scannt aktuelle Events nahe GPS.
 * Ohne sourceUrl oder ohne echte Nähe / Audience-Fit → leer.
 */
export async function researchTemporaryLiveSpots(opts: {
  lat: number;
  lng: number;
  cityHint?: string | null;
  timeoutMs?: number;
  maxDistanceM?: number;
  forAmbientPitch?: boolean;
  user?: TemporaryLiveUserCtx | null;
}): Promise<TemporaryLiveSpot[]> {
  if (!hasGeminiApiKey()) return [];
  const today = new Date().toISOString().slice(0, 10);
  const city = (opts.cityHint || '').trim();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxM = opts.maxDistanceM ?? DEFAULT_NEAR_M;
  const user = opts.user ?? null;
  const age = user?.age ?? 30;
  const band = resolveAgeBandLocal(age);
  const skip = (user?.softSkipTags ?? []).join(', ') || '—';

  const audienceBlock = user
    ? [
        `USER: ca. ${age} Jahre (Band ${band}), Reisegruppe=${user.travelParty ?? 'unbekannt'}, Nightlife=${user.nightlifeOk ? 'ok' : 'nicht pushen'}.`,
        user.aboutMe ? `Über User: ${user.aboutMe.slice(0, 220)}` : '',
        `Soft-Skips (nicht vorschlagen): ${skip}.`,
        'Zielgruppe MUSS passen: Kids/Spielstadt nur mit Familien-Kontext;',
        'Ü30-Partys nicht an klar Jüngere; Techno/18+ nicht an Senioren/Familien ohne Nightlife.',
        'Wenn unsicher, weglassen.',
      ]
        .filter(Boolean)
        .join(' ')
    : 'Zielgruppe grob schätzen (audienceTags, audienceMinAge/MaxAge).';

  const prompt = [
    `Du suchst aktuelle Events/Programme HEUTE (${today}) im Umkreis ~${Math.round(maxM / 1000)} km um GPS ${opts.lat.toFixed(5)},${opts.lng.toFixed(5)}${city ? ` (${city})` : ''}.`,
    'Quellen: Venue-Seiten, Kalender, Flyer, Instagram/Facebook-Posts mit Datum — nur mit echter HTTPS-URL.',
    'Ohne URL → []. Lieber [] als raten. Nichts erfinden.',
    'VERBOTEN: erfundene Parties; feste Läden als Event verkaufen ohne heutiges Programm;',
    'Meter schätzen ist ok — App prüft Nähe (Places oder venueLat/Lng).',
    audienceBlock,
    'ZEIT-FILTER: Tagesfeste (Straßenfest, Weinfest, Hafengeburtstag, Umzug, Markt, Kinderprogramm) dürfen schon laufen — whenLabel dann „läuft noch bis …“ nur mit belegtem Ende. Zeitgenaue Starts (Kino, Konzert, Auftritt, Vorstellung, Sonnenfinsternis) nur wenn Start noch kommt — schon begonnen weglassen, kein „läuft noch“. Ende vorbei → weglassen. Nichts Passendes → [].',
    'Max 4 Treffer, sortiert nach Passung für DIESE Person.',
    'hook: 1–2 flüssige Sätze (Du). Zeitrelation (heute Abend + Uhr wenn belegt) + Ort + Was in einem Atemzug. Ungefragt: kurzer menschlicher Opener, dann Hiebsatz, dann weiche Einladung ob einplanen. KEIN Los-jetzt (keine „in X Minuten da“, keine „um die Ecke“ als Sofort-Los). Uhr nur aus Belegen.',
    FINDUS_WOVEN_PITCH_SPEECH_BLOCK,
    'audienceTags: z.B. kids|family|nightlife|techno|ue30|market|culture|seniors',
    FINDUS_FEW_SHOT_DISCLAIMER,
    '',
    'JSON array only:',
    '[{ "name":"…", "kindHint":"markt|festival|popup|party|kids|culture|other", "whenLabel":"heute / ab 18 Uhr", "distanceHintM":800, "hook":"…", "sourceUrl":"https://…", "audienceTags":["…"], "audienceMinAge":18, "audienceMaxAge":null, "venueLat":53.65, "venueLng":9.79 }]',
  ].join('\n');

  try {
    const raw = await Promise.race([
      generateGeminiText(prompt, {
        task: 'research',
        enableGoogleSearch: true,
        maxTokens: opts.forAmbientPitch ? 900 : 500,
        temperature: 0.15,
        useFindusSystem: false,
      }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('temp_live_timeout')), timeoutMs),
      ),
    ]);
    const arr = extractJsonArray(raw);
    if (!arr?.length) return [];
    const candidates: TemporaryLiveSpot[] = [];
    for (const row of arr.slice(0, 4)) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const hook = typeof o.hook === 'string' ? o.hook.trim() : '';
      const sourceUrl =
        typeof o.sourceUrl === 'string' && /^https?:\/\//i.test(o.sourceUrl)
          ? o.sourceUrl.trim()
          : null;
      if (name.length < 3 || hook.length < 8 || !sourceUrl) continue;
      if (isBrochureHook(hook)) continue;
      const whenLabel =
        typeof o.whenLabel === 'string' ? o.whenLabel.trim() : 'heute';
      const kindHint =
        typeof o.kindHint === 'string' ? o.kindHint.trim() : 'other';
      if (
        !isUpcomingForUnsolicitedPitch(`${whenLabel} ${name} ${hook}`, undefined, {
          kindHint,
        })
      ) {
        continue;
      }
      const audienceTags = Array.isArray(o.audienceTags)
        ? o.audienceTags
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 8)
        : [];
      const venueLat =
        typeof o.venueLat === 'number' && Number.isFinite(o.venueLat)
          ? o.venueLat
          : null;
      const venueLng =
        typeof o.venueLng === 'number' && Number.isFinite(o.venueLng)
          ? o.venueLng
          : null;
      const audienceMinAge =
        typeof o.audienceMinAge === 'number' && Number.isFinite(o.audienceMinAge)
          ? o.audienceMinAge
          : null;
      const audienceMaxAge =
        typeof o.audienceMaxAge === 'number' && Number.isFinite(o.audienceMaxAge)
          ? o.audienceMaxAge
          : null;
      candidates.push({
        name,
        kindHint,
        whenLabel,
        distanceHintM: null,
        hook: hook.slice(0, 180),
        sourceUrl,
        audienceTags,
        audienceMinAge,
        audienceMaxAge,
        venueLat,
        venueLng,
      });
    }

    const out: TemporaryLiveSpot[] = [];
    for (const c of candidates) {
      const verifiedM = await verifyTemporaryLiveDistanceM({
        name: c.name,
        lat: opts.lat,
        lng: opts.lng,
        maxM,
        venueLat: c.venueLat,
        venueLng: c.venueLng,
      });
      if (verifiedM == null) continue;
      const enriched: TemporaryLiveSpot = {
        ...c,
        distanceHintM: verifiedM,
        audienceTags: inferAudienceTags(c),
      };
      if (user && !spotFitsUserAudience(enriched, user)) continue;
      out.push(enriched);
    }
    return out;
  } catch {
    return [];
  }
}

export { formatTemporaryLiveSpeech };

export function formatTemporaryLivePromptBlock(
  spots: TemporaryLiveSpot[],
): string {
  if (!spots.length) return '';
  return [
    'TEMPORÄRE LIVE-ORTE (heute, belegt — nur wenn User in der Nähe / relevant):',
    ...spots.map(
      (s, i) =>
        `${i + 1}. ${s.name} (${s.kindHint}, ${s.whenLabel}${s.distanceHintM != null ? `, ~${s.distanceHintM} m` : ''}): ${s.hook}${s.sourceUrl ? ` · ${s.sourceUrl}` : ''}`,
    ),
  ].join('\n');
}
