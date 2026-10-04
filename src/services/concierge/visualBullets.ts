/**
 * Spickzettel-Stichpunkte — max. 3, aus dem Gesprochenen, keine Adresse/GPS.
 * Node-sicher (kein RN-Store).
 */

import {
  filterAddressCoordBullets,
  looksLikeAddressOrCoordBullet,
} from '../../utils/addressPrivacy';
import { isMetaStructureBullet } from '../../module2/speech/draftToHumanSpeech';
import { compactBulletDigits, speechHasBulletDigit } from './bulletDigits';

/** Maximal 3 Spickzettel-Stichpunkte (Hardfacts). */
export const MAX_VISUAL_BULLETS = 3;

/**
 * Kinoprogramm / Venue-Programm-Liste nach Wahl — mehr Einträge erlaubt.
 * Jeder Eintrag trotzdem max. 2 UI-Zeilen, nie abgeschnitten.
 */
export const MAX_PROGRAM_LIST_BULLETS = 7;

/** Surface: Fallback-Cap vor Layout-Messung (UI misst echter). */
export type BulletSurface = 'default' | 'module1' | 'pitch' | 'nav' | 'program';

export const BULLET_SURFACE_MAX_CHARS: Record<BulletSurface, number> = {
  /**
   * Konservativ bis onLayout — lieber kürzer als UI-Ellipse („…“).
   * Echte Breite überschreibt in BulletsSlot (2 Zeilen × gemessene Breite).
   */
  default: 56,
  module1: 56,
  nav: 52,
  /** Zwei Spalten nebeneinander — eng */
  pitch: 36,
  /** Programm-Liste: oft volle Kartenbreite, trotzdem knapp halten */
  program: 56,
};

/** @deprecated — nutze BULLET_SURFACE_MAX_CHARS.default */
export const MAX_BULLET_CHARS = BULLET_SURFACE_MAX_CHARS.default;

/** Kartentitel „Programm — …“ → Listen-Cap 7 statt 3. */
export function isProgramBulletCard(title: string | null | undefined): boolean {
  return /^\s*programm\b/iu.test(String(title ?? ''));
}


/** Prosa-Sätze als Stichpunkt — ablehnen (FACT-CHIPS statt Fließtext). */
const PROSE_BULLET_OPENER_RE =
  /^(?:also|gerade|heute|morgen|abend|nacht|in\s+\p{L}+|es\s+(?:sieht|wird|ist)|liegst\s+du|schau|lass\s+uns|für\s+eine|insgesamt|am\s+besten)\b/iu;


/** Review-Snips die mit „…wort“ starten — unleserlich, droppen oder säubern. */
export function stripLeadingEllipsisSnippet(raw: string): string {
  let b = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!b) return '';
  // führende Ellipse + Wortrest → ab erstem Großbuchstaben/Wortanfang
  if (/^(?:\u2026|\.\.\.)/.test(b)) {
    b = b.replace(/^(?:\u2026|\.\.\.)+\s*/u, '');
    // mittendrin angefangenes Wort (z. B. „n, Giant“) → bis Interpunktion/Wortgrenze
    if (/^[a-zäöüß]{1,3}[,:;]/u.test(b)) {
      b = b.replace(/^[a-zäöüß]{1,3}[,:;]\s*/u, '');
    }
  }
  b = b.replace(/(?:\u2026|\.\.\.)$/u, '').trim();
  // unvollständige Klammer am Ende: „(164“ → ohne Klammerteil
  b = b.replace(/\s*\([^)]*$/u, '').trim();
  b = b.replace(/\s*\([^)]{0,12}$/u, '').trim();
  return b;
}

export function looksLikeProseBullet(raw: string): boolean {
  const b = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!b) return true;
  const words = b.split(/\s+/).length;
  // Zahl-Fakten (Einwohner/km²/Alter/Preis) bleiben Chips, auch etwas länger
  if (/\d/.test(b) && words <= 14) return false;
  if (/[.!?]$/.test(b) && words >= 8) return true;
  if (PROSE_BULLET_OPENER_RE.test(b) && words >= 6 && !/\d/.test(b)) return true;
  if (words >= 12 && !b.includes('·') && !/[€$°%]/.test(b) && !/\d/.test(b)) return true;
  return false;
}

function normalizeBulletFactKey(b: string): string {
  return b
    .toLowerCase()
    .replace(/\b(alter|jahre?|geboren|am)\b/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/**
 * LLM splittet oft „45.000 Menschen“ → „45“ + „000 Menschen…“.
 * Vor dem Fit wieder zusammenkleben.
 */
export function glueSplitThousandBullets(raw: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = String(raw[i] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const next = String(raw[i + 1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const head = cur.match(/^(.{0,80}?)(\d{1,3})$/u);
    const tail = next.match(/^(0{3}|\d{3})(\b.*)$/u);
    if (head && tail && !/\d{4,}/.test(cur)) {
      const merged = `${head[1]}${head[2]}.${tail[1]}${tail[2]}`
        .replace(/\s+/g, ' ')
        .trim();
      out.push(merged);
      i += 1;
      continue;
    }
    if (cur) out.push(cur);
  }
  return out;
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
  // „• “ + Innenabstand — etwas großzügiger, sonst greift RN-Ellipse
  const prefix = opts.bulletPrefixPx ?? 22;
  const usable = Math.max(48, opts.widthPx - prefix);
  // DE oft breiter als EN; 0.68em → lieber 1 Zeichen zu wenig als „…“
  const perLine = Math.max(16, Math.floor(usable / (fontSize * 0.68)));
  return Math.max(20, perLine * lines);
}

/** Abgebrochene Satzfragmente — lieber weglassen als „… auf etwa“. */
const INCOMPLETE_TAIL_WORD_RE =
  /\b(etwa|rund|ca\.?|circa|bis|bei|auf|mit|von|zu|zum|zur|für|fuer|daher|deshalb|weil|wenn|noch|schon|leicht|bewölkt|bewoelkt|trocken|reicht|dann|dort|hier|also|typisch)\s*$/iu;

const INCOMPLETE_BARE_NUMBER_RE =
  /\b(?:rund|etwa|ca\.?|circa|bei)\s+(?:null|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|\d+[.,]?\d*)\s*$/iu;

export function looksLikeIncompleteBullet(raw: string): boolean {
  const t = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s•\-–—*]+/u, '')
    .replace(/\s*(\.\.\.|…)\s*$/u, '')
    .trim();
  if (!t) return true;
  if (/[.!?]$/.test(t)) return false;
  if (INCOMPLETE_TAIL_WORD_RE.test(t)) return true;
  if (INCOMPLETE_BARE_NUMBER_RE.test(t)) return true;
  if (/\b(reicht|deshalb|daher)\s+(heute|morgen|jetzt|noch)?\s*$/iu.test(t)) {
    return true;
  }
  if (/\bauf\s+(etwa|rund|ca\.?|circa)\s*$/iu.test(t)) return true;
  if (
    /\bbei\s+rund\s+[a-zäöüß]+\s*$/iu.test(t) &&
    !/\b(grad|°|uhr|\d)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** Vollständige Sätze aus Speech — Outfit/Wetter-Spickzettel. */
export function deriveCompleteSentenceBullets(
  speech: string,
  opts?: { maxCount?: number; maxChars?: number },
): string[] {
  const maxCount = Math.max(1, opts?.maxCount ?? MAX_VISUAL_BULLETS);
  const maxChars = Math.max(24, opts?.maxChars ?? BULLET_SURFACE_MAX_CHARS.default);
  const chunks = String(speech ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const out: string[] = [];
  for (const chunk of chunks) {
    const fitted = rewriteBulletToFit(chunk, maxChars);
    if (!fitted || looksLikeIncompleteBullet(fitted)) continue;
    out.push(fitted);
    if (out.length >= maxCount) break;
  }
  return out;
}

function stripDanglingTail(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(
        /\s+(und|oder|sowie|mit|von|zu|zum|zur|bei|in|im|am|an|auf|für|fuer|seit|bis|nach|dem|den|der|die|das|des|ein|eine|einem|einer|eines|als|auch|noch|dann|dort|hier)\s*$/iu,
        '',
      )
      .replace(/[,;:·\-–—/]\s*$/u, '')
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function compressPhrase(s: string, max: number): string {
  const limit = Math.max(12, Math.floor(max));
  let t = s
    .replace(BULLET_FLUFF_RE, ' ')
    .replace(/\b(das|die|der|dem|den|ein|eine|einem|einer|eines)\s+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = s.trim();
  if (t.length <= limit) return stripDanglingTail(t);
  const window = t.slice(0, limit + 1);
  const cuts = [' · ', ' — ', ' – ', '; ', ', ', ' / ', ' '];
  for (const c of cuts) {
    const i = window.lastIndexOf(c);
    if (i >= Math.floor(limit * 0.4)) {
      return stripDanglingTail(window.slice(0, i));
    }
  }
  const sp = window.lastIndexOf(' ');
  if (sp >= Math.floor(limit * 0.5)) {
    return stripDanglingTail(window.slice(0, sp));
  }
  return stripDanglingTail(t.slice(0, limit));
}

/**
 * Kürzt einen Stichpunkt so, dass er PASST und trotzdem Sinn ergibt.
 * Nie droppen, nie „…“ / Wort-Halbierung als UI-Lösung.
 */
/** Fläche: lieber „164 ha“ als abgeschnittene m²-Klammer. */
function compactAreaBullet(raw: string): string {
  let b = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!b) return '';
  const ha = b.match(/^(.{2,40}?):\s*.*?\b(\d+[.,]?\d*)\s*ha\b/iu);
  if (ha) return `${ha[1]!.trim()} · ${ha[2]} ha`;
  const qm = b.match(
    /^(.{2,40}?):\s*(?:rund|ca\.?|etwa)?\s*([\d.]+)\s*Quadratmeter\b/iu,
  );
  if (qm) {
    const n = Number(String(qm[2]).replace(/\./g, ''));
    if (Number.isFinite(n) && n >= 10_000) {
      const haN = Math.round(n / 10_000);
      return `${qm[1]!.trim()} · ${haN} ha`;
    }
  }
  return b;
}

export function rewriteBulletToFit(raw: string, maxChars: number): string {
  const limit = Math.max(18, Math.floor(maxChars));
  let b = compactAreaBullet(
    String(raw ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s•\-–—*]+/u, '')
      .replace(/\s*(\.\.\.|…)\s*$/u, '')
      .replace(/^(?:\u2026|\.\.\.)+\s*/u, '')
      .replace(/\s*\([^)]*$/u, ''),
  )
    // Deutsche Tausender: 2.297 → Anzeige „2.297“ behalten (kein Split „2“|„297“)
    // Nur normalisieren wenn wir matchen — nicht zu 2297 plattmachen (Speech-Gate).
    .replace(/\b(\d{1,3})\.(\d{3})\b/g, '$1.$2')
    .trim();
  if (!b) return '';
  if (b.length <= limit) {
    const whole = stripDanglingTail(b);
    return looksLikeIncompleteBullet(whole) ? '' : whole;
  }

  const year = b.match(/\b((?:1[0-9]{3}|20[0-2]\d))\b/);
  if (year) {
    const rest = b
      .replace(year[0], ' ')
      .replace(BULLET_FLUFF_RE, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s·,\-–—)+\]]+|[\s·,\-–—)+\]]+$/g, '')
      .trim();
    const budget = limit - year[0].length - 3;
    if (budget >= 8 && rest.length >= 6 && /[A-Za-zÄÖÜäöüß]/u.test(rest)) {
      const core = compressPhrase(rest, budget);
      if (core && /[A-Za-zÄÖÜäöüß]/u.test(core) && core.length >= 4) {
        return stripDanglingTail(`${year[0]} · ${core}`);
      }
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
    if (core) return stripDanglingTail(`${head} · ${core}`);
    return stripDanglingTail(compressPhrase(head, limit));
  }

  const fitted = stripDanglingTail(compressPhrase(b, limit) || b.slice(0, limit));
  if (looksLikeIncompleteBullet(fitted) && b.length > limit + 8) return '';
  return fitted;
}

/** Leere Labels, TTS-Meta, unfertige Fakten — raus. */
export function isWeakOrMetaBullet(raw: string): boolean {
  const b = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!b || b.length < 3) return true;
  // Gold/Contract Struktur-Chips (z. B. AYCE) — nie Spickzettel
  if (isMetaStructureBullet(b)) return true;
  if (
    /\b(ausgeschrieben|buchstabier|in worten|als wörter|als worte|ziffern vermeiden)\b/iu.test(
      b,
    )
  ) {
    return true;
  }
  if (/[:：]\s*(\.\.\.|…)?\s*$/u.test(b)) return true;
  // Orphan year / "23)" crumbs from rewrite
  if (/^(?:\d{1,4}\)?|\d{4}\s*[·\-]\s*\)?)$/u.test(b)) return true;
  if (/^[)\]\}.,;:·\-–—]+$/u.test(b)) return true;
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
    /** UI-Kontext: pitch = enger; program = bis 7 */
    surface?: BulletSurface;
    /** Nur Fakten aus speechText (keine Halluzination) */
    speechText?: string | null;
    /** Override Cap (default 3, program 7) */
    maxCount?: number;
    /** Gemessenes UI-Budget (Zeichen / 2 Zeilen) — sonst Surface-Default */
    maxChars?: number;
    /** Kartentitel — nicht 1:1 als Stichpunkt wiederholen */
    cardTitle?: string | null;
  },
): string[] {
  const surface = opts?.surface ?? 'default';
  const maxChars = Math.max(
    18,
    opts?.maxChars ??
      BULLET_SURFACE_MAX_CHARS[surface] ??
      BULLET_SURFACE_MAX_CHARS.default,
  );
  const maxCount = Math.max(
    1,
    opts?.maxCount ??
      (surface === 'program' ? MAX_PROGRAM_LIST_BULLETS : MAX_VISUAL_BULLETS),
  );
  const speech = (opts?.speechText ?? '').replace(/\s+/g, ' ').trim();
  const speechLc = speech.toLowerCase();
  const userLc = (opts?.userText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const corpusLc = `${speechLc} ${userLc}`.trim();

  const cleaned: string[] = [];
  for (const raw of filterAddressCoordBullets(
    glueSplitThousandBullets(bullets),
    opts,
  )) {
    // Früh: Call-2/Gold-Meta nie in den Spickzettel
    if (isMetaStructureBullet(String(raw ?? ''))) continue;
    let b = stripLeadingEllipsisSnippet(
      String(raw ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s•\-–—*]+/u, '')
        .trim(),
    );
    if (!b || isWeakOrMetaBullet(b)) continue;
    if (/^(?:\u2026|\.\.\.)/.test(String(raw ?? '').trim())) {
      // Roh-Snip mit führender Ellipse war Review-Müll — nach Clean trotzdem prüfen
      if (b.length < 8 || looksLikeProseBullet(b)) continue;
    }
    if (looksLikeProseBullet(b)) continue;
    const titleLc = String(opts?.cardTitle ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (titleLc && b.toLowerCase() === titleLc) continue;
    if (
      titleLc.length >= 12 &&
      b.toLowerCase().includes(titleLc) &&
      b.length <= titleLc.length + 8
    ) {
      continue;
    }
    // Stichpunkt nie = Speech (Spickzettel fasst zusammen, liest nicht vor)
    if (speechLc && b.toLowerCase() === speechLc) continue;
    if (
      speechLc.length >= 12 &&
      speechLc === b.toLowerCase().replace(/[.!?]+$/u, '').trim()
    ) {
      continue;
    }
    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)
    if (looksLikeStarRatingBullet(b)) continue;
    b = compactBulletDigits(b);
    b = b
      .replace(/\s*ausgeschrieben\b.*$/iu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!b || isWeakOrMetaBullet(b) || looksLikeStarRatingBullet(b)) continue;
    // Speech/User-Gate: Stichpunkt muss zur Frage/Antwort passen — 1–2 Extra-Fakten ok
    if (corpusLc.length >= 24) {
      const digits = b.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const tokens = b
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 4);
      const digitOk =
        digits.length === 0 ||
        digits.some(
          (d) =>
            speechHasBulletDigit(speech, d) ||
            speechHasBulletDigit(opts?.userText ?? '', d) ||
            corpusLc.includes(d.replace(/\./g, '')),
        );
      // Maß-Stichpunkte (Fläche/km²/ha/Doppelfeld): Zahl belegt → Label-Token darf fehlen
      // (User sagt „groß“, Speech „1,6 km²“ — Label „Fläche“ steht oft nur im Bullet)
      const measureOk =
        digitOk &&
        /\b\d+[.,]?\d*\s*(?:km\s*[²2]?|km2|ha|hektar|m\s*[²2]|m2|quadrat|×|x)\b/iu.test(
          b,
        );
      const hit = tokens.filter((t) => corpusLc.includes(t)).length;
      const tokenOk =
        tokens.length === 0 ||
        hit >= 1 ||
        measureOk ||
        // Kurzer Eigenname / Amtstitel als Extra-Fakt zur Frage
        (b.length <= maxChars &&
          tokens.length <= 4 &&
          /\b(könig|koenig|queen|papst|präsident|praesident|kaiser|herzog)\w*\b/iu.test(
            `${userLc} ${b}`,
          ));
      if (!digitOk || !tokenOk) continue;
    }
    const fitted = rewriteBulletToFit(b, maxChars);
    const truncated = fitted.length + 4 < b.length;
    if (
      !fitted ||
      isWeakOrMetaBullet(fitted) ||
      (truncated && looksLikeIncompleteBullet(fitted))
    ) {
      continue;
    }
    cleaned.push(fitted);
  }

  cleaned.sort((a, b) => scoreBulletImportance(b) - scoreBulletImportance(a));

  const out: string[] = [];
  const seen = new Set<string>();
  const seenFact = new Set<string>();
  const seenDist = new Set<string>();
  let distOnlyCount = 0;
  for (const b of cleaned) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    const factKey = normalizeBulletFactKey(b);
    if (factKey && seenFact.has(factKey)) continue;
    // Dieselbe km/m-Zahl nicht zweimal (z. B. „1,3 km“ + „Hotel: 1,3 km“)
    const distKey = distanceTokenKey(b);
    if (distKey && seenDist.has(distKey)) continue;
    // Max. ein reiner Distanz-Stichpunkt — Platz für Wunsch-Fakten
    if (looksLikeDistanceOnlyBullet(b)) {
      if (distOnlyCount >= 1) continue;
      distOnlyCount += 1;
    }
    seen.add(key);
    if (factKey) seenFact.add(factKey);
    if (distKey) seenDist.add(distKey);
    out.push(b);
    if (out.length >= maxCount) break;
  }
  return out;
}
