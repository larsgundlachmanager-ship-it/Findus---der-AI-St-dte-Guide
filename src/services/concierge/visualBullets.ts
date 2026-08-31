/**
 * Spickzettel-Stichpunkte — max. 3, aus dem Gesprochenen, keine Adresse/GPS.
 * Node-sicher (kein RN-Store).
 */

import {
  filterAddressCoordBullets,
  looksLikeAddressOrCoordBullet,
} from '../../utils/addressPrivacy';
import { compactBulletDigits, speechHasBulletDigit } from './bulletDigits';

/** Maximal 3 Spickzettel-Stichpunkte. */
export const MAX_VISUAL_BULLETS = 3;

/** Surface: Fallback-Cap vor Layout-Messung (UI misst echter). */
export type BulletSurface = 'default' | 'module1' | 'pitch' | 'nav';

export const BULLET_SURFACE_MAX_CHARS: Record<BulletSurface, number> = {
  /** Konservativ bis onLayout — echte Breite überschreibt in BulletsSlot */
  default: 72,
  module1: 72,
  nav: 64,
  /** Zwei Spalten nebeneinander — eng */
  pitch: 40,
};

/** @deprecated — nutze BULLET_SURFACE_MAX_CHARS.default */
export const MAX_BULLET_CHARS = BULLET_SURFACE_MAX_CHARS.default;

const BULLET_FLUFF_RE =
  /\b(wurde|worden|hat man|man hat|damals|nämlich|eigentlich|richtig|sehr|besonders|bereits|schon|dann|dort|hier)\b/giu;

/** Roh-Sterne / Review-Counts — nicht in Stichpunkten (Speech darf soft „gut bewertet“). */
const STAR_RATING_BULLET_RE =
  /\b\d+[.,]\d+\s*★|\b\d+[.,]\d+\s*sterne?\b|\bsterne?\s*(bei|aus)\b|\b\d+\s*bewertungen?\b|\bbewertung\s*\d/iu;

/** Nur Distanz / Name+km — ohne Wunsch-Fakt. */
const DISTANCE_ONLY_BULLET_RE =
  /^(?:[^:]{2,40}:\s*)?(?:ca\.?\s*)?\d+[.,]?\d*\s*(?:km|m)\s*$/iu;

function looksLikeStarRatingBullet(b: string): boolean {
  return STAR_RATING_BULLET_RE.test(b);
}

function looksLikeDistanceOnlyBullet(b: string): boolean {
  return DISTANCE_ONLY_BULLET_RE.test(b.trim());
}

function distanceTokenKey(b: string): string | null {
  const m = b.match(/(\d+[.,]?\d*)\s*(km|m)\b/iu);
  if (!m) return null;
  return `${m[1]!.replace(',', '.')}${m[2]!.toLowerCase()}`;
}

function scoreBulletImportance(b: string): number {
  let s = 0;
  if (/\d/.test(b)) s += 8; // Zahlen/Preise/Zeiten zuerst
  // Wunsch-/Entscheidungsfakten vor bloßer Distanz
  if (/[€$]|euro|uhr|%|pool|sauna|vegan|steak|menü|speisekarte|offen|geschlossen|terrasse|meerblick|massage|all.?inclusive/i.test(b)) {
    s += 6;
  }
  if (/min\b|km\b|m\b|stunde/i.test(b) && !looksLikeDistanceOnlyBullet(b)) s += 2;
  if (looksLikeDistanceOnlyBullet(b)) s -= 4;
  if (looksLikeStarRatingBullet(b)) s -= 20;
  if (b.length <= 56) s += 2;
  if (b.length > 120) s -= 3;
  return s;
}

/** Max. Zeichen aus gemessener UI-Breite (Schriftgröße / 2 Zeilen). */
export function estimateBulletMaxChars(opts: {
  widthPx: number;
  fontSize?: number;
  lines?: number;
  bulletPrefixPx?: number;
}): number {
  const fontSize = opts.fontSize ?? 14;
  const lines = opts.lines ?? 2;
  const prefix = opts.bulletPrefixPx ?? 16;
  const usable = Math.max(48, opts.widthPx - prefix);
  // DE-Durchschnitt ~0.55em; enger = sicherer (keine UI-Ellipse)
  const perLine = Math.max(18, Math.floor(usable / (fontSize * 0.58)));
  return Math.max(22, perLine * lines);
}

function compressPhrase(s: string, max: number): string {
  const limit = Math.max(12, Math.floor(max));
  let t = s
    .replace(BULLET_FLUFF_RE, ' ')
    .replace(/\b(das|die|der|dem|den|ein|eine|einem|einer|eines)\s+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = s.trim();
  if (t.length <= limit) return t;
  const window = t.slice(0, limit + 1);
  const cuts = [' · ', ' — ', ' – ', '; ', ', ', ' / ', ' '];
  for (const c of cuts) {
    const i = window.lastIndexOf(c);
    if (i >= Math.floor(limit * 0.4)) {
      return window.slice(0, i).trim();
    }
  }
  const sp = window.lastIndexOf(' ');
  if (sp >= Math.floor(limit * 0.5)) return window.slice(0, sp).trim();
  return t.slice(0, limit).trim();
}

/**
 * Kürzt einen Stichpunkt so, dass er PASST und trotzdem Sinn ergibt.
 * Nie droppen, nie „…“ / Wort-Halbierung als UI-Lösung.
 */
export function rewriteBulletToFit(raw: string, maxChars: number): string {
  const limit = Math.max(18, Math.floor(maxChars));
  let b = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s•\-–—*]+/u, '')
    .replace(/\s*(\.\.\.|…)\s*$/u, '')
    .trim();
  if (!b) return '';
  if (b.length <= limit) return b;

  const year = b.match(/\b((?:1[0-9]{3}|20[0-2]\d))\b/);
  if (year) {
    const rest = b
      .replace(year[0], ' ')
      .replace(BULLET_FLUFF_RE, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s·,\-–—]+|[\s·,\-–—]+$/g, '')
      .trim();
    const budget = limit - year[0].length - 3;
    if (budget >= 8) {
      const core = compressPhrase(rest || b, budget);
      if (core) return `${year[0]} · ${core}`;
    }
  }

  // Zahlen/Preise vorne halten
  const leadNum = b.match(
    /^(.{0,24}?\b\d+[.,]?\d*\s*(?:€|m|km|min|h|%|Pkt|Punkte|Stufen|Uhr)?)/iu,
  );
  if (leadNum && leadNum[1] && leadNum[1].length < limit - 6) {
    const head = leadNum[1].trim();
    const rest = b.slice(head.length).replace(/^[\s·,\-–—]+/, '').trim();
    const core = compressPhrase(rest, limit - head.length - 3);
    if (core) return `${head} · ${core}`;
    return compressPhrase(head, limit);
  }

  return compressPhrase(b, limit) || b.slice(0, limit).trim();
}

/** Leere Labels, TTS-Meta, unfertige Fakten — raus. */
export function isWeakOrMetaBullet(raw: string): boolean {
  const b = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!b || b.length < 3) return true;
  if (
    /\b(ausgeschrieben|buchstabier|in worten|als wörter|als worte|ziffern vermeiden)\b/iu.test(
      b,
    )
  ) {
    return true;
  }
  if (/[:：]\s*(\.\.\.|…)?\s*$/u.test(b)) return true;
  if (/\b(höhe|stufen|eintritt|preis|länge|breite|baujahr|öffnungs)\b/iu.test(b) && !/\d/.test(b)) {
    return true;
  }
  if (
    /^(historie|venue-offers|maps-pitch|fakten|live|heute|wissen)\b/iu.test(b) &&
    !/\d/.test(b)
  ) {
    return true;
  }
  if (looksLikeAddressOrCoordBullet(b)) return true;
  return false;
}

export function clampVisualBullets(
  bullets: string[],
  opts?: {
    userText?: string | null;
    allowAddress?: boolean;
    /** UI-Kontext: pitch = enger */
    surface?: BulletSurface;
    /** Nur Fakten aus speechText (keine Halluzination) */
    speechText?: string | null;
  },
): string[] {
  const maxChars =
    BULLET_SURFACE_MAX_CHARS[opts?.surface ?? 'default'] ??
    BULLET_SURFACE_MAX_CHARS.default;
  const speech = (opts?.speechText ?? '').replace(/\s+/g, ' ').trim();
  const speechLc = speech.toLowerCase();

  const cleaned: string[] = [];
  for (const raw of filterAddressCoordBullets(bullets, opts)) {
    let b = String(raw ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s•\-–—*]+/u, '')
      .replace(/\s*(\.\.\.|…)\s*$/u, '')
      .trim();
    if (!b || isWeakOrMetaBullet(b)) continue;
    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)
    if (looksLikeStarRatingBullet(b)) continue;
    b = compactBulletDigits(b);
    b = b
      .replace(/\s*ausgeschrieben\b.*$/iu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!b || isWeakOrMetaBullet(b) || looksLikeStarRatingBullet(b)) continue;
    // Speech-Gate: Stichpunkt muss im Gesagten vorkommen (Zahlen/Tokens)
    if (speechLc.length >= 40) {
      const digits = b.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const tokens = b
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 4);
      const digitOk =
        digits.length === 0 ||
        digits.some((d) => speechHasBulletDigit(speech, d));
      const tokenOk =
        tokens.length === 0 ||
        tokens.filter((t) => speechLc.includes(t)).length >=
          Math.min(2, tokens.length);
      if (!digitOk || !tokenOk) continue;
    }
    const fitted = rewriteBulletToFit(b, maxChars);
    if (!fitted || isWeakOrMetaBullet(fitted)) continue;
    cleaned.push(fitted);
  }

  cleaned.sort((a, b) => scoreBulletImportance(b) - scoreBulletImportance(a));

  const out: string[] = [];
  const seen = new Set<string>();
  const seenDist = new Set<string>();
  let distOnlyCount = 0;
  for (const b of cleaned) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    // Dieselbe km/m-Zahl nicht zweimal (z. B. „1,3 km“ + „Hotel: 1,3 km“)
    const distKey = distanceTokenKey(b);
    if (distKey && seenDist.has(distKey)) continue;
    // Max. ein reiner Distanz-Stichpunkt — Platz für Wunsch-Fakten
    if (looksLikeDistanceOnlyBullet(b)) {
      if (distOnlyCount >= 1) continue;
      distOnlyCount += 1;
    }
    seen.add(key);
    if (distKey) seenDist.add(distKey);
    out.push(b);
    if (out.length >= MAX_VISUAL_BULLETS) break;
  }
  return out;
}
