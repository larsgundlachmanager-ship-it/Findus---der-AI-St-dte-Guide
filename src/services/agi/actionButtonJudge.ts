/**
 * Action-Button-Richter — Validity / Functional / Context.
 * Defekte Buttons werden isoliert repariert oder entfernt; die Antwort bleibt stehen.
 * Pipeline-Position: nach Pass-2 (+ Enrich/Sync), VOR Speech-Guardrails.
 */

import type {
  GeminiConciergeResponse,
  QuickAction,
  QuickActionType,
} from '../../types/concierge';
import {
  ACTION_LABEL_MAX_CHARS,
  shortenActionLabel,
} from '../concierge/actionLabelShorten';

export { ACTION_LABEL_MAX_CHARS };

const VALID_TYPES = new Set<QuickActionType>([
  'START_NAVIGATION',
  'DIAL_PHONE',
  'OPEN_URL',
  'SHOW_MORE',
  'CONFIRM_API_RESERVATION',
  'SEND_RESERVATION_EMAIL',
  'TRIGGER_AI_CALL',
  'OPEN_GYG_WIDGET',
  'BOOK_UBER',
  'BOOK_CAR_RENTAL',
  'BOOK_BOUNCE_LUGGAGE',
  'BOOK_STAY22',
  'BOOK_ESIM',
  'COMPLETE_SHOPPING_TASK',
  'SNOOZE_SHOPPING_TASK',
  'SET_WAKE_ALARM',
  'SET_TIMER',
  'SET_DEPARTURE_REMINDER',
  'SHOW_STREET_VIEW',
]);

const PLACEHOLDER_RE =
  /^(null|undefined|n\/?a|none|todo|tbd|placeholder|ziel|location|ort|hier|example|test|xxx|\.+|—|–|-)$/iu;

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'number' && !Number.isFinite(v)) return true;
  if (typeof v === 'string') {
    const t = v.trim();
    return !t || PLACEHOLDER_RE.test(t);
  }
  return false;
}

function looksLikeUrl(u: string): boolean {
  return /^https?:\/\/\S+/i.test(u.trim()) || /^www\.\S+/i.test(u.trim());
}

function clampLabel(label: string, fallback: string): string {
  const t = shortenActionLabel(label || fallback);
  return t || shortenActionLabel(fallback);
}

/** User will Navigation / Route. */
export function userWantsNavigation(userText: string): boolean {
  if (
    /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route\s+(?:zu|nach|starten)|lass\s+uns\s+(?:zum|zur|nach)|zeig\s+mir\s+den\s+weg|wie\s+komme\s+ich|geh(?:en)?\s+(?:wir\s+)?(?:zum|zur|nach))\b/iu.test(
      userText,
    )
  ) {
    return true;
  }
  // Wander-/Fahrradweg-Vorschlag = Bewegung zum Einstieg
  try {
    const { isTrailPathQuery } = require('../research/trailPathResearch') as {
      isTrailPathQuery: (t: string) => boolean;
    };
    if (isTrailPathQuery(userText)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Reine Wissens-/Info-Frage ohne Bewegungswunsch. */
export function isKnowledgeOnlyQuery(userText: string): boolean {
  if (userWantsNavigation(userText)) return false;
  return /\b(wann|wie\s+viel|gibt\s+es|öffnungs|oeffnungs|frühstück|fruehstueck|check[- ]?in|check[- ]?out|was\s+ist|erzähl|erzaehl|geschichte|wer\s+war|warum|bedeutet|info|informationen)\b/iu.test(
    userText,
  );
}

function speechMentionsNavTarget(speech: string, destName: string): boolean {
  const name = destName.trim();
  if (name.length < 3) return false;
  const s = speech.toLowerCase();
  const n = name.toLowerCase();
  if (s.includes(n)) return true;
  const tokens = n.split(/\s+/).filter((w) => w.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => s.includes(tok));
}

function speechCommitsNavigation(speech: string): boolean {
  return /\b(ich\s+starte\s+(?:direkt\s+)?die\s+navigation|ich\s+(führ|fuehr|bring|navigier)|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+(?:startet|läuft|laeuft)|route\s+startet|folge(?:\s+\w+){0,3}\s+dem\s+pfeil)\b/iu.test(
    speech,
  );
}

export type ActionJudgeNote = {
  index: number;
  type: string;
  label: string;
  action: 'kept' | 'repaired' | 'removed';
  reason: string;
};

export type ActionButtonJudgeResult = {
  actions: QuickAction[];
  notes: ActionJudgeNote[];
  changed: boolean;
};

/**
 * Validity + Functional + Context Check für jeden Button.
 * Fehler → reparieren oder isoliert entfernen.
 */
export function judgeActionButtons(
  actions: QuickAction[],
  opts: { userText: string; speechText: string },
): ActionButtonJudgeResult {
  const notes: ActionJudgeNote[] = [];
  const out: QuickAction[] = [];
  const knowledgeOnly = isKnowledgeOnlyQuery(opts.userText);
  const wantsNav = userWantsNavigation(opts.userText);
  const speech = opts.speechText ?? '';

  for (let i = 0; i < actions.length; i++) {
    const raw = actions[i];
    if (!raw || typeof raw !== 'object') {
      notes.push({
        index: i,
        type: '?',
        label: '',
        action: 'removed',
        reason: 'invalid_object',
      });
      continue;
    }

    const type = raw.type as QuickActionType;
    if (!VALID_TYPES.has(type)) {
      notes.push({
        index: i,
        type: String(raw.type ?? ''),
        label: String(raw.label ?? ''),
        action: 'removed',
        reason: 'invalid_type',
      });
      continue;
    }

    const payload = { ...(raw.payload ?? {}) };
    let label = clampLabel(String(raw.label ?? ''), type);
    let repaired = label !== String(raw.label ?? '').trim();
    let removeReason: string | null = null;

    switch (type) {
      case 'START_NAVIGATION': {
        // Functional: Ziel muss auflösbar sein
        if (isBlank(payload.destName) && !isBlank(label)) {
          const fromLabel = label
            .replace(/^📍\s*/u, '')
            .replace(/^Route:\s*/iu, '')
            .trim();
          if (!isBlank(fromLabel)) {
            payload.destName = fromLabel;
            repaired = true;
          }
        }
        const hasId = payload.targetPoiId != null && !isBlank(String(payload.targetPoiId));
        const hasCoords =
          typeof payload.destLat === 'number' &&
          typeof payload.destLng === 'number' &&
          Number.isFinite(payload.destLat) &&
          Number.isFinite(payload.destLng);
        const hasName = !isBlank(payload.destName);
        const hasMulti =
          Array.isArray(payload.multiStop) && payload.multiStop.length > 0;

        if (!hasId && !hasCoords && !hasName && !hasMulti) {
          removeReason = 'nav_empty_payload';
          break;
        }

        // Context: Wissensfrage ohne Nav-Intent → kein START_NAVIGATION
        if (knowledgeOnly && !wantsNav) {
          const dest = String(payload.destName || '');
          const okBySpeech =
            speechCommitsNavigation(speech) &&
            (hasName ? speechMentionsNavTarget(speech, dest) : hasId || hasCoords);
          if (!okBySpeech) {
            removeReason = 'nav_context_knowledge_only';
            break;
          }
        }
        break;
      }
      case 'DIAL_PHONE': {
        if (isBlank(payload.phoneNumber)) {
          removeReason = 'dial_empty_phone';
          break;
        }
        const digitsOnly = String(payload.phoneNumber).replace(/\D/g, '');
        // Dynamische Notruf-Kurzwahlen (112/911/999/000/116117/…)
        let isEmergencyShort = false;
        try {
          const {
            isKnownEmergencyShort,
          } = require('../concierge/emergencyNumbersByCountry') as {
            isKnownEmergencyShort: (d: string) => boolean;
          };
          isEmergencyShort = isKnownEmergencyShort(digitsOnly);
        } catch {
          isEmergencyShort =
            /^(112|110|911|999|000|116117)$/.test(digitsOnly) ||
            /^116\d{3}$/.test(digitsOnly);
        }
        // Notruf-Kurzwahlen sind gültig; sonst mind. 6 Ziffern
        if (!isEmergencyShort && digitsOnly.length < 6) {
          removeReason = 'dial_invalid_phone';
        }
        break;
      }
      case 'OPEN_URL':
      case 'BOOK_ESIM': {
        if (isBlank(payload.url) || !looksLikeUrl(String(payload.url))) {
          removeReason = 'url_missing_or_invalid';
        }
        break;
      }
      case 'SHOW_MORE': {
        if (isBlank(payload.textPrompt)) {
          removeReason = 'show_more_empty_prompt';
        }
        break;
      }
      case 'OPEN_GYG_WIDGET': {
        if (isBlank(payload.gygTourSlug) && isBlank(payload.gygLocationId)) {
          removeReason = 'gyg_empty_slug';
        }
        break;
      }
      case 'BOOK_UBER': {
        const hasCoords =
          typeof payload.destLat === 'number' &&
          typeof payload.destLng === 'number';
        if (!hasCoords && isBlank(payload.destName) && payload.targetPoiId == null) {
          removeReason = 'uber_empty_dest';
        }
        break;
      }
      case 'BOOK_STAY22': {
        if (isBlank(payload.destination) && isBlank(payload.destName)) {
          // Soft-repair: Stadt aus Speech nicht rate — entfernen
          removeReason = 'stay22_empty_destination';
        } else if (isBlank(payload.destination) && !isBlank(payload.destName)) {
          payload.destination = String(payload.destName);
          repaired = true;
        }
        break;
      }
      case 'BOOK_CAR_RENTAL':
      case 'BOOK_BOUNCE_LUGGAGE':
        // URL oft erst in Enrich gesetzt — ok ohne URL
        break;
      case 'CONFIRM_API_RESERVATION':
      case 'SEND_RESERVATION_EMAIL':
      case 'TRIGGER_AI_CALL': {
        if (payload.targetPoiId == null && isBlank(payload.destName)) {
          removeReason = 'reservation_no_target';
        }
        break;
      }
      case 'COMPLETE_SHOPPING_TASK':
      case 'SNOOZE_SHOPPING_TASK': {
        if (isBlank(payload.taskId)) {
          removeReason = 'shopping_no_task_id';
        }
        break;
      }
      case 'SET_WAKE_ALARM':
      case 'SET_TIMER':
      case 'SET_DEPARTURE_REMINDER': {
        // Zeit-Anker ODER konkreter Ort (destName) — Soft-Offer ohne beides fliegt raus
        const hasWhen =
          !isBlank(payload.timeLabel) ||
          !isBlank(payload.textPrompt) ||
          !isBlank(payload.dateIso) ||
          (typeof payload.durationMs === 'number' &&
            Number.isFinite(payload.durationMs) &&
            payload.durationMs >= 1000);
        const hasPlace = !isBlank(payload.destName);
        if (!hasWhen && !hasPlace) {
          removeReason = 'reminder_empty_when';
        }
        break;
      }
      case 'SHOW_STREET_VIEW': {
        if (
          typeof payload.destLat !== 'number' ||
          typeof payload.destLng !== 'number' ||
          !Number.isFinite(payload.destLat) ||
          !Number.isFinite(payload.destLng)
        ) {
          removeReason = 'street_view_no_coords';
        }
        break;
      }
      default:
        break;
    }

    if (removeReason) {
      notes.push({
        index: i,
        type,
        label,
        action: 'removed',
        reason: removeReason,
      });
      continue;
    }

    const next: QuickAction = { type, label, payload };
    out.push(next);
    if (repaired) {
      notes.push({
        index: i,
        type,
        label,
        action: 'repaired',
        reason: 'normalized_label_or_payload',
      });
    } else {
      notes.push({
        index: i,
        type,
        label,
        action: 'kept',
        reason: 'ok',
      });
    }
  }

  const changed =
    out.length !== actions.length ||
    notes.some((n) => n.action === 'repaired' || n.action === 'removed');

  return { actions: out.slice(0, 4), notes, changed };
}

/**
 * Wendet den Action-Button-Richter auf die gesamte Concierge-Antwort an.
 */
export function applyActionButtonJudge(
  response: GeminiConciergeResponse,
  opts: { userText: string },
): {
  response: GeminiConciergeResponse;
  notes: ActionJudgeNote[];
  changed: boolean;
} {
  const judged = judgeActionButtons(response.quickActions ?? [], {
    userText: opts.userText,
    speechText: response.speechText ?? '',
  });
  return {
    response: {
      ...response,
      quickActions: judged.actions,
    },
    notes: judged.notes,
    changed: judged.changed,
  };
}
