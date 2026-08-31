/**
 * Butler Offer Bus — ein starker Next-Step (kein Himmels-Spezialpfad).
 */

import type { Module2ActionButton } from '../types';
import {
  buildRemindOnlyModule2Button,
  resolveReminderAnchor,
  speechOffersRemind,
  userAsksRemind,
} from '../../services/concierge/reminderActionPolicy';
import { looksLikeSlotGluedBridge, sanitizeBridgeText } from './bridgeGlue';

export { looksLikeSlotGluedBridge, sanitizeBridgeText };

export type ButlerOfferKind =
  | 'reminder'
  | 'plan'
  | 'wake_alarm'
  | 'nav'
  | 'pitch'
  | 'explain'
  | 'settings'
  | 'clarify'
  | 'local_show';

export type ButlerOffer = {
  kind: ButlerOfferKind;
  speechSuffix: string;
  button?: Module2ActionButton;
};

export function pickButlerOffer(opts: {
  userText: string;
  speech: string;
  weatherOkOutdoor?: boolean;
  hasNavTarget?: boolean;
  needsClarify?: boolean;
  /** Chat/JSON hat Reminder angeboten */
  wantsReminder?: boolean;
  /** Optional: bekannter Leave-by / Dest-Anker */
  leaveByMs?: number | null;
  destName?: string | null;
  /** Chat/JSON hat lokalen Auftritt erkannt */
  localShowHint?: string | null;
}): ButlerOffer | null {
  const u = opts.userText;
  const s = opts.speech;

  if (opts.needsClarify) {
    return { kind: 'clarify', speechSuffix: '' };
  }

  const wantsRemind =
    Boolean(opts.wantsReminder) ||
    speechOffersRemind(s) ||
    userAsksRemind(u);
  if (wantsRemind) {
    const anchor = resolveReminderAnchor({
      speech: s,
      userText: u,
      destName: opts.destName,
      leaveByMs: opts.leaveByMs,
    });
    // Ohne konkreten Ort/Zeit: kein Reminder-Button (und kein Soft-Offer-Zwang).
    if (!anchor.ok) {
      return null;
    }
    const button = buildRemindOnlyModule2Button({
      speech: s,
      userText: u,
      destName: opts.destName ?? anchor.place,
      leaveByMs: opts.leaveByMs ?? anchor.atMs,
      requireOfferOrAsk: false,
    });
    if (!button) return null;
    return {
      kind: 'reminder',
      speechSuffix: '',
      button,
    };
  }

  if (opts.localShowHint) {
    const tip = opts.localShowHint.slice(0, 80);
    return {
      kind: 'local_show',
      speechSuffix: '',
      button: {
        id: 'butler_local_show',
        label: 'Tickets / Infos',
        payload: {
          kind: 'ui',
          action: 'text_prompt',
          data: {
            textPrompt: `Erzähl mehr zum Auftritt / Termin: ${tip}`,
          },
        },
      },
    };
  }

  if (
    opts.weatherOkOutdoor &&
    /\b(draußen|draussen|terrasse|outdoor|außen)\b/iu.test(u)
  ) {
    return {
      kind: 'pitch',
      speechSuffix: '',
      button: {
        id: 'butler_pitch_outdoor',
        label: 'Plätze draußen',
        payload: {
          kind: 'ui',
          action: 'text_prompt',
          data: {
            textPrompt: 'Such mir Plätze zum Draußensitzen / Terrasse',
          },
        },
      },
    };
  }

  if (/\b(wecker|aufsteh|aufstehen|auf\s*stehen|weck(?:e)?\s+mich|geweckt|alarm)\b/iu.test(u)) {
    return {
      kind: 'wake_alarm',
      speechSuffix: '',
      button: {
        id: 'butler_wake',
        label: 'Wecker stellen',
        payload: {
          kind: 'ui',
          action: 'text_prompt',
          data: { textPrompt: 'Ja, Wecker stellen' },
        },
      },
    };
  }

  if (opts.hasNavTarget) {
    return { kind: 'nav', speechSuffix: '' };
  }

  if (/\bwas\s+ist\b/iu.test(u) && s.length < 120) {
    return {
      kind: 'explain',
      speechSuffix: '',
    };
  }

  return null;
}

export function mergeOfferIntoSpeech(
  speech: string,
  offer: ButlerOffer | null,
): string {
  if (!offer?.speechSuffix) return speech;
  const base = speech.trim();
  if (!base) return offer.speechSuffix.trim();
  if (base.includes(offer.speechSuffix.trim().slice(0, 20))) return base;
  return `${base}${offer.speechSuffix}`;
}
