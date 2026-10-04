/**
 * Reisebegleiter-Vorausdenken — Timeline-Konflikte, Wetter-Shift, Pack-als-Cache.
 * Struktur/Blaupause, keine Orts-/Dialog-Hardcodes.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';

export type TimelineForesightKind =
  | 'hard_overlap'
  | 'soft_squeeze'
  | 'weather_shift';

export type TimelineForesightHit = {
  kind: TimelineForesightKind;
  /** Kurzer Struktur-Hinweis für Ask-Back (Wortlaut frei); null = nur Intent */
  askBackHint: string | null;
  /** Addon für authorIntent / Call-2 Geländer */
  authorIntentAddon: string;
  anchorTitle: string;
  anchorStartMs: number | null;
};

const EVENING_ACTIVITY_RE =
  /\b(theater|theatre|kino|cinema|konzert|musical|club|party|picknick|picnic|michel|turm|aussicht|museum|vorher|noch\s+(?:schnell|kurz)|stattdessen|lieber)\b/iu;

const DINING_ANCHOR_RE =
  /\b(essen|restaurant|tisch|reserv|abendessen|mittag|mercedes|dinner|gastro)\b/iu;

function isHardDiningAnchor(s: FuturePlanStop): boolean {
  if (s.status === 'done') return false;
  if (s.hardAnchor === true) return true;
  if (s.reserveUrl) return true;
  const blob = `${s.title} ${s.notes || ''}`.toLowerCase();
  return (
    DINING_ANCHOR_RE.test(blob) &&
    typeof s.plannedStartMs === 'number' &&
    Number.isFinite(s.plannedStartMs)
  );
}

function competingWish(userText: string): boolean {
  return EVENING_ACTIVITY_RE.test(userText || '');
}

/**
 * Offener Plan vs. neuer Wunsch — Reservierung/Anker nicht still überschreiben.
 */
export function detectTimelineForesight(opts: {
  userText: string;
  nowMs?: number;
  stops?: FuturePlanStop[] | null;
}): TimelineForesightHit | null {
  const t = String(opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t || !competingWish(t)) return null;
  const now = opts.nowMs ?? Date.now();
  const stops = (opts.stops ?? []).filter(
    (s) => s && s.status !== 'done' && s.status !== 'conflict',
  );
  if (!stops.length) return null;

  const anchors = stops
    .filter(isHardDiningAnchor)
    .filter((s) => {
      const start = s.plannedStartMs;
      if (typeof start !== 'number' || !Number.isFinite(start)) return true;
      // nur heutige / baldige Anker (bis +18h)
      return start >= now - 30 * 60_000 && start <= now + 18 * 3600_000;
    })
    .sort(
      (a, b) =>
        (a.plannedStartMs ?? Number.MAX_SAFE_INTEGER) -
        (b.plannedStartMs ?? Number.MAX_SAFE_INTEGER),
    );

  const anchor = anchors[0];
  if (!anchor) return null;

  const start = anchor.plannedStartMs ?? null;
  const hours =
    typeof start === 'number' ? Math.round((start - now) / 3600_000) : null;
  const beforeCue = /\b(vorher|noch\s+(?:schnell|kurz)|davor|vor\s+dem)\b/iu.test(
    t,
  );
  const replaceCue =
    /\b(stattdessen|lieber|abbrechen|stornier|absag|nicht\s+mehr\s+essen)\b/iu.test(
      t,
    );

  if (replaceCue || (competingWish(t) && !beforeCue && hours != null && hours <= 4)) {
    return {
      kind: 'hard_overlap',
      anchorTitle: anchor.title,
      anchorStartMs: start,
      askBackHint:
        'Offener Tisch/Anker heute Abend vs. neuer Wunsch — klar fragen: Anker behalten, stornieren, oder neuen Wunsch davor einplanen?',
      authorIntentAddon: [
        `Timeline-Anker „${anchor.title}"${start ? ` (~${new Date(start).getHours()}:${String(new Date(start).getMinutes()).padStart(2, '0')})` : ''}`,
        'Nicht still überschreiben — Konflikt transparent, Optionen: behalten / stornieren / davor einplanen',
      ].join('. '),
    };
  }

  if (beforeCue && hours != null && hours <= 3) {
    return {
      kind: 'soft_squeeze',
      anchorTitle: anchor.title,
      anchorStartMs: start,
      askBackHint: null,
      authorIntentAddon: [
        `Vor dem Anker „${anchor.title}" noch etwas einplanen`,
        'Öffnung/Dauer prüfen — wenn zu eng oder zu: ehrlich sagen und Alternative (morgen / kürzer / anderer Ort)',
        'Anker-Tisch nicht ohne Nachfrage kippen',
      ].join('. '),
    };
  }

  return null;
}

export function foresightAskBack(
  hit: TimelineForesightHit | null,
): string | null {
  return hit?.askBackHint ?? null;
}

export function packAsCacheAuthorIntent(): string {
  return [
    'Pack/Datensatz = Cache für Tempo/Kosten — fehlt etwas: live suchen, Lösung liefern, Treffer speichern (lokal+Inbox+Karte)',
    'Live widerspricht Pack-Claim → Treffer verwerfen, weiter suchen bis Musts sitzen',
    'Hard-Musts (AYCE, kein Asiatisch, Open-Air, …) vor Publish streng — Soft-Fill verboten',
  ].join('. ');
}

export function picnicForesightAuthorIntent(userText: string): string {
  const active =
    /\b(sport|aktiv|tischtennis|volleyball|bewegung|laufen|joggen)\b/iu.test(
      userText,
    );
  return [
    'Picknick: Parks/Wiesen nah am User, Sitz-/Schatten wenn belegt',
    'Wetter parallel — Regen am Nachmittag → früher vorschlagen oder Alternative',
    active
      ? 'Aktiver Kontext: Parks mit Spiel/Sport-Fläche soft bevorzugen wenn belegt'
      : 'Prefs/Charakter dosiert für Spot-Wahl',
    packAsCacheAuthorIntent(),
  ].join('. ');
}
