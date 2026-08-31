/**
 * Reminder Action Policy — SSOT für „Erinnern“-Buttons.
 *
 * Regel: Soft-Offer („soll ich dich erinnern“) nur mit Button,
 * und nur wenn ein konkreter Ort ODER eine konkrete Zeit belegt ist.
 * Struktur-Blaupause — kein festes Wortlaut-Skript.
 */

import type { QuickAction } from '../../types/concierge';
import { resolveDateTimeMs } from '../time/temporalGerman';
import { parseTimerDurationMs } from '../alarms/timerService';
import { shortenActionLabel } from './actionLabelShorten';

/** Speech bietet Erinnern an (Permission-/Offer-Form). */
export function speechOffersRemind(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\bsoll\s+ich\s+(?:dich|euch)\s+erinner/iu.test(t) ||
    /\b(?:kann|könnte|koennte)\s+ich\s+(?:dich|euch)\s+erinner/iu.test(t) ||
    /\bich\s+(?:erinner|melde)\s+(?:dich|euch)\b/iu.test(t) ||
    /\b(?:sag|sage)\s+(?:ich\s+)?(?:dir|euch)\s+bescheid\b/iu.test(t) ||
    /\berinner(?:e|ung)?\s+(?:dich|euch)\s+(?:gern|rechtzeitig|recht\s+zeitig)\b/iu.test(
      t,
    )
  );
}

/** User will selbst erinnert werden. */
export function userAsksRemind(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\berinner(?:e|ung)?\s+mich\b/iu.test(t) ||
    /\bsag\s+(?:mir\s+)?bescheid\b/iu.test(t) ||
    /\bnicht\s+vergessen\b/iu.test(t) ||
    /\bverpass(?:en)?\s+(?:nicht|ich)\b/iu.test(t) ||
    /\bwann\s+muss\s+ich\s+los\b/iu.test(t) ||
    /\bstell(?:e)?\s+(?:mir\s+)?(?:eine\s+)?erinnerung\b/iu.test(t) ||
    /\bmelde\s+mich\b.{0,24}\b(?:um|wenn|sobald)\b/iu.test(t) ||
    /\bpush\s+(?:mich|mir)\b/iu.test(t)
  );
}

/** Speech behauptet, Erinnerung sei schon aktiv — ohne Execution = Fake. */
export function speechClaimsReminderSet(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\bich\s+erinnere\s+dich\b/iu.test(t) ||
    /\berinnerung\s+(?:ist\s+)?(?:gestellt|gesetzt|aktiv)\b/iu.test(t) ||
    /\bich\s+melde\s+mich\b.{0,32}\b(?:um|spätestens|rechtzeitig)\b/iu.test(t) ||
    /\bsag(?:e|)\s+(?:ich\s+)?(?:dir|euch)\s+bescheid\b/iu.test(t)
  );
}

/**
 * Konkrete Uhrzeit / Relativdauer aus Text.
 * „heute Abend“ allein ohne Uhr → keine konkrete Zeit.
 */
export function extractConcreteReminderTimeMs(
  text: string,
  now = Date.now(),
): number | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const durationMs = parseTimerDurationMs(t);
  if (
    durationMs != null &&
    durationMs >= 60_000 &&
    /\b(?:in\s+\d|nach\s+\d|minuten?|stunden?)\b/iu.test(t)
  ) {
    return now + durationMs;
  }

  const fromSsot = resolveDateTimeMs({ text: t });
  if (
    fromSsot != null &&
    fromSsot >= now + 20_000 &&
    (/\bum\b|\buhr\b|:\d{2}/i.test(t) ||
      (/\b(?:heute|morgen|übermorgen|uebermorgen)\b/iu.test(t) &&
        /\b\d{1,2}\b/.test(t) &&
        /\bum\b|\buhr\b|:\d{2}/i.test(t)))
  ) {
    return fromSsot;
  }

  const clock =
    t.match(/\b(?:um\s*)?(\d{1,2})[:.](\d{2})\b/) ||
    t.match(/\b(?:um\s*)?(\d{1,2})\s*uhr\b/i);
  if (clock && (/\bum\b|\buhr\b|:\d{2}/i.test(t) || /\d[:.]\d{2}/.test(t))) {
    const h = Number(clock[1]);
    const m = clock[2] != null && clock[2] !== '' ? Number(clock[2]) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const d = new Date(now);
      d.setSeconds(0, 0);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < now + 20_000) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
  }

  return null;
}

const PLACE_STOP =
  /^(?:Heute|Morgen|Abend|Uhr|Minuten|Stunde|Dich|Mich|Dir|Mir|Hier|Dort|Dann|Noch|Sehr|Bitte|Rechtzeitig)$/iu;

/**
 * Konkreter Ortsanker aus User-/Speech-Text.
 * Kein generisches „irgendwo“ / „später“.
 */
export function extractConcreteReminderPlace(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(?:irgendwo|egal\s+wo|später\s+mal|irgendwann)\b/iu.test(t)) {
    return null;
  }

  const patterns: RegExp[] = [
    /\b(?:bei|am|an|zum|zur|im|in|auf|Richtung)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/u,
    /\berinner\w*\s+mich\s+(?:an\s+|zum\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/iu,
    /\b(?:Haltestelle|Bahnhof|Flughafen|Hafen|Hotel|Museum|Strand|Markt)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})/u,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const place = m[1].replace(/[.,!?;:]+$/g, '').trim();
    if (place.length < 3 || PLACE_STOP.test(place)) continue;
    if (/^\d/.test(place)) continue;
    return place.slice(0, 48);
  }
  return null;
}

export type ReminderAnchor = {
  /** true wenn Ort und/oder Zeit konkret */
  ok: boolean;
  atMs: number | null;
  place: string | null;
  reason: 'time' | 'place' | 'time_and_place' | 'none';
};

export function resolveReminderAnchor(opts: {
  speech?: string;
  userText?: string;
  destName?: string | null;
  leaveByMs?: number | null;
  dateIso?: string | null;
  nowMs?: number;
}): ReminderAnchor {
  const now = opts.nowMs ?? Date.now();
  const blob = [opts.userText, opts.speech].filter(Boolean).join(' ');

  let atMs: number | null = null;
  if (
    opts.leaveByMs != null &&
    Number.isFinite(opts.leaveByMs) &&
    opts.leaveByMs >= now + 20_000
  ) {
    atMs = opts.leaveByMs;
  } else if (opts.dateIso) {
    const parsed = Date.parse(opts.dateIso);
    if (Number.isFinite(parsed) && parsed >= now + 20_000) atMs = parsed;
  }
  if (atMs == null) atMs = extractConcreteReminderTimeMs(blob, now);

  const place =
    (opts.destName && opts.destName.trim().length >= 2
      ? opts.destName.trim().slice(0, 48)
      : null) || extractConcreteReminderPlace(blob);

  if (atMs != null && place) {
    return { ok: true, atMs, place, reason: 'time_and_place' };
  }
  if (atMs != null) return { ok: true, atMs, place: null, reason: 'time' };
  if (place) return { ok: true, atMs: null, place, reason: 'place' };
  return { ok: false, atMs: null, place: null, reason: 'none' };
}

function formatClockDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Baut einen echten Erinnern-Button — oder null ohne Anker.
 */
export function buildRemindOnlyQuickAction(opts: {
  speech?: string;
  userText?: string;
  destName?: string | null;
  leaveByMs?: number | null;
  dateIso?: string | null;
  /** Wenn false: Button nur wenn Speech/User Reminder anbietet/fragt */
  requireOfferOrAsk?: boolean;
  nowMs?: number;
}): QuickAction | null {
  const speech = opts.speech ?? '';
  const userText = opts.userText ?? '';
  if (opts.requireOfferOrAsk !== false) {
    const offerOrAsk =
      speechOffersRemind(speech) ||
      userAsksRemind(userText) ||
      speechOffersRemind(userText);
    if (!offerOrAsk) return null;
  }

  const anchor = resolveReminderAnchor(opts);
  if (!anchor.ok) return null;

  const place = anchor.place;
  const label = anchor.atMs
    ? shortenActionLabel(
        place
          ? `⏰ ${place} ${formatClockDe(anchor.atMs)}`
          : `⏰ Erinnern ${formatClockDe(anchor.atMs)}`,
      )
    : shortenActionLabel(place ? `⏰ ${place}` : '⏰ Erinnern');

  return {
    type: 'SET_DEPARTURE_REMINDER',
    label,
    payload: {
      ...(anchor.atMs
        ? { dateIso: new Date(anchor.atMs).toISOString() }
        : {}),
      ...(place ? { destName: place } : {}),
      timeLabel: anchor.atMs
        ? formatClockDe(anchor.atMs)
        : place
          ? 'am Ort'
          : undefined,
      textPrompt: place
        ? `Erinnerung: ${place}`
        : userText.slice(0, 120) || 'Erinnerung',
    },
  };
}

/** Module2-Button-Payload für presentToUi → SET_DEPARTURE_REMINDER. */
export function buildRemindOnlyModule2Button(opts: {
  speech?: string;
  userText?: string;
  destName?: string | null;
  leaveByMs?: number | null;
  dateIso?: string | null;
  requireOfferOrAsk?: boolean;
}): {
  id: string;
  label: string;
  payload: {
    kind: 'ui';
    action: 'set_departure_reminder';
    data: Record<string, unknown>;
  };
} | null {
  const qa = buildRemindOnlyQuickAction(opts);
  if (!qa) return null;
  return {
    id: 'remind_only',
    label: qa.label.slice(0, 20),
    payload: {
      kind: 'ui',
      action: 'set_departure_reminder',
      data: {
        ...(typeof qa.payload.dateIso === 'string'
          ? { dateIso: qa.payload.dateIso }
          : {}),
        ...(typeof qa.payload.destName === 'string'
          ? { destName: qa.payload.destName }
          : {}),
        ...(typeof qa.payload.timeLabel === 'string'
          ? { timeLabel: qa.payload.timeLabel }
          : {}),
        ...(typeof qa.payload.textPrompt === 'string'
          ? { textPrompt: qa.payload.textPrompt }
          : {}),
      },
    },
  };
}
