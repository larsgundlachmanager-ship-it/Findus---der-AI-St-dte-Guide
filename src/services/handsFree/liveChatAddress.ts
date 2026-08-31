/**
 * Heuristik: Richtet sich die Äußerung an Yorro oder an jemanden daneben?
 *
 * openFloor=true (nach Start / nach Antwort, innerhalb Idle):
 * freie Follow-ups ohne Namens-Keyword — z. B. „führ mich dahin“.
 *
 * Beside-Modus: User spricht mit einer anderen Person → still bis Wake/Name.
 * Weiche Slang-Anrede („Alter“, „Digga“) + klare Frage gilt als an Yorro —
 * nicht als Side-Chat, und löst kein 3-Minuten-Mute aus.
 */

import {
  bumpBesideConversation,
  clearBesideConversation,
  isBesideConversationActive,
} from './besideConversationMode';

export type LiveChatAddressResult = {
  addressed: boolean;
  /** Text ohne Wake-/Name-Prefix */
  cleanText: string;
  reason: string;
};

/** Markenname + Legacy „Findus“ während Umstellung. */
const WAKE_RE =
  /^(?:hey|hi|hallo|ok|okay|na|so)\s*,?\s*(?:yorro|findus)\b[,!.]?\s*/i;
const NAME_ANYWHERE_RE = /\b(?:yorro|findus)\b/i;

/** Klare Concierge-Imperative / Fragen (auch ohne Namen). */
const DIRECT_RE =
  /^(?:was|wo|wie|wann|wer|welch(?:e[rsn]?)?|wird|wär(?:e)?|waere|soll|möchte|moechte|hast|habt|gibt(?:'?s)?|kannst|könntest|koenntest|zeig|führ|fuehr|bring|geh|lauf|navigier|erklär|erklaer|erzähl|erzaehl|such|finde|öffne|oeffne|stell|mach|plan|buch|reservier|erinner|wecker|wie\s+weit|wie\s+lange|und\s+dann|noch\s+was|mehr\s+dazu)\b/i;

/** Follow-up Navigation / Anapher ohne Keyword. */
const FOLLOW_NAV_RE =
  /\b(?:führ|fuehr|bring|geh|lauf|navigier|zeig).{0,40}\b(?:dahin|dort(?:hin)?|hin|mich|uns)\b|\b(?:dahin|dort(?:hin)?)\b.+\b(?:bitte|führ|fuehr|bring)\b|\b(?:ja\s+bitte|mach\s+das|los\s+geht|leg\s+los|start(?:e)?\s+(?:die\s+)?route|route\s+starten)\b/i;

/**
 * Weiche Slang-Anrede am Satzanfang — oft an Yorro
 * („Alter, wie spät?“), nicht automatisch an jemanden daneben.
 */
const SOFT_VOCATIVE_PREFIX_RE =
  /^(?:(?:ey|alter|digga|na|yo)[,!.]?\s+)+/i;

/** Harte Anrede an eine andere Person. */
const HARD_SIDE_RE =
  /\b(?:mein\s+freund|schatz|liebling|honey|babe|mama|papa|opa|oma)\b/i;

/** Side-Chat-Filler ohne klare Frage an Yorro. */
const SIDE_FILLER_RE =
  /\b(?:warte|komm(?:\s+her)?|schau\s+mal|guck\s+mal|hör\s+mal|sag\s+mal\s+(?:du|mal)|weiß\s+du\s+was|weißt\s+du\s+was)\b/i;

/** Filler + harte Drittanrede — ohne Slang-Vocative. */
const SIDE_CHAT_RE = new RegExp(
  `(?:${HARD_SIDE_RE.source})|(?:${SIDE_FILLER_RE.source})`,
  'i',
);

/** Tech-/Alltags-Hilfe an jemanden daneben (ohne Yorro-Name). */
const SIDE_TECH_RE =
  /\b(?:windows|laptop|pc\b|computer|iphone|android|passwort|wlan|wifi|drucker|browser|excel|outlook|handy\s+(?:geht|spinnt|hängt)|bildschirm)\b/i;

const TRAVEL_CTX_RE =
  /\b(?:restaurant|pizza|route|museum|hotel|stadt|strand|navig|parkplatz|café|cafe|aussicht|sonnenuntergang|führ|fuehr|bring\s+mich)\b/i;

const ACK_ONLY_RE =
  /^(?:ja|nein|nee|nö|no|hm+|mhm|aha|ok|okay|genau|stimmt|klar|cool|nice|super|danke|bitte|weiter|später|spaeter)\.?$/i;

/** Inhaltliche Aussage (Adresse, Zeitspanne, Satz) — nicht nur Side-Chat-Fluff. */
export function isSubstantiveLiveChatUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  if (t.length >= 12) return true;
  if (/\d/.test(t)) return true;
  if (
    /\b(uhr|straße|strasse|str\.|weg|platz|allee|bis|von|im|in|am|an)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function stripLiveChatWakePrefix(text: string): string {
  return text.replace(WAKE_RE, '').trim();
}

/** „Alter, …“ / „Ey Digga …“ vom Satzanfang — Rest bleibt die eigentliche Frage. */
export function stripSoftLiveChatVocative(text: string): string {
  return text.replace(SOFT_VOCATIVE_PREFIX_RE, '').trim();
}

export function isWakePhraseOnly(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!WAKE_RE.test(t) && !/^(?:yorro|findus)\b/i.test(t)) return false;
  const clean = stripLiveChatWakePrefix(t).replace(
    /^(?:yorro|findus)\b[,!.]?\s*/i,
    '',
  );
  return clean.length < 2;
}

/** Planung wartet auf Sprache → jede sinnvolle Äußerung annehmen. */
function planningNeedsAnySpeech(): boolean {
  try {
    const { getFlightTripSession } = require('../flights/flightTripSession') as {
      getFlightTripSession: () => { pendingAsk?: string | null } | null;
    };
    if (getFlightTripSession()?.pendingAsk) return true;
  } catch {
    /* soft */
  }
  try {
    const { isPlanAwaitingUserReply } = require('../../module2/planning/planSessionState') as {
      isPlanAwaitingUserReply: () => boolean;
    };
    if (isPlanAwaitingUserReply()) return true;
  } catch {
    /* soft */
  }
  try {
    const { usePlanSessionStore } = require('../../module2/planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => {
          active?: boolean;
          phase?: string;
        };
      };
    };
    const s = usePlanSessionStore.getState();
    if (
      s.active &&
      (s.phase === 'clarify_location' ||
        s.phase === 'await_confirm' ||
        s.phase === 'await_conflict' ||
        s.phase === 'select_mode' ||
        s.phase === 'step_loop')
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

function looksLikeAddressedAsk(text: string): boolean {
  const t = stripSoftLiveChatVocative(text.replace(/\s+/g, ' ').trim());
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (DIRECT_RE.test(t)) return true;
  if (FOLLOW_NAV_RE.test(t)) return true;
  return false;
}

function looksLikeSideHumanTalk(text: string): boolean {
  if (NAME_ANYWHERE_RE.test(text)) return false;
  if (looksLikeAddressedAsk(text)) return false;
  if (HARD_SIDE_RE.test(text) && !FOLLOW_NAV_RE.test(text) && !TRAVEL_CTX_RE.test(text)) {
    return true;
  }
  if (SIDE_FILLER_RE.test(text) && !FOLLOW_NAV_RE.test(text) && !TRAVEL_CTX_RE.test(text)) {
    return true;
  }
  if (SIDE_TECH_RE.test(text) && !TRAVEL_CTX_RE.test(text)) return true;
  return false;
}

function ignoreSide(text: string, reason: string): LiveChatAddressResult {
  bumpBesideConversation(reason);
  return { addressed: false, cleanText: text, reason };
}

export function classifyLiveChatAddress(
  raw: string,
  opts?: { openFloor?: boolean },
): LiveChatAddressResult {
  const text = raw.replace(/\s+/g, ' ').trim();
  const openFloor = opts?.openFloor === true;
  const beside = isBesideConversationActive();
  const core = stripSoftLiveChatVocative(text) || text;

  if (text.length < 2) {
    return { addressed: false, cleanText: '', reason: 'empty' };
  }

  if (WAKE_RE.test(text)) {
    clearBesideConversation('wake');
    try {
      const {
        looksLikeSmalltalkCompanion,
        markSmalltalkCompanion,
      } = require('./smalltalkCompanionMode') as {
        looksLikeSmalltalkCompanion: (t: string) => boolean;
        markSmalltalkCompanion: (r?: string) => void;
      };
      const cleanWake = stripLiveChatWakePrefix(text);
      if (looksLikeSmalltalkCompanion(cleanWake || text)) {
        markSmalltalkCompanion('wake_companion');
      }
    } catch {
      /* soft */
    }
    const clean = stripLiveChatWakePrefix(text);
    if (clean.length < 2) {
      return { addressed: true, cleanText: '', reason: 'wake_only' };
    }
    return { addressed: true, cleanText: clean, reason: 'wake_prefix' };
  }

  if (NAME_ANYWHERE_RE.test(text)) {
    clearBesideConversation('name');
    const clean = text
      .replace(/\b(?:hey|hi|hallo)?\s*(?:yorro|findus)\b[,!.]?\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      addressed: true,
      cleanText: clean.length >= 2 ? clean : text,
      reason: 'name_mention',
    };
  }

  // Sticky Beside: Wake/Name, Travel-Nav, oder klare Frage an Yorro (nicht Tech/Schatz).
  if (beside) {
    if (FOLLOW_NAV_RE.test(text) && TRAVEL_CTX_RE.test(text)) {
      clearBesideConversation('travel_follow');
      return { addressed: true, cleanText: text, reason: 'beside_travel_follow' };
    }
    if (
      (looksLikeAddressedAsk(text) || isSubstantiveLiveChatUtterance(text)) &&
      !SIDE_TECH_RE.test(text) &&
      !HARD_SIDE_RE.test(text)
    ) {
      clearBesideConversation('clear_ask');
      return { addressed: true, cleanText: text, reason: 'beside_clear_ask' };
    }
    return ignoreSide(text, 'beside_hold');
  }

  if (looksLikeSideHumanTalk(text)) {
    return ignoreSide(text, 'side_human');
  }

  // Planungs-Gates / aktive Session: Antworten (Adresse, Weiter, Zeiten) nicht verwerfen
  if (planningNeedsAnySpeech() && text.length >= 2) {
    if (
      SIDE_CHAT_RE.test(text) &&
      !looksLikeAddressedAsk(text) &&
      !isSubstantiveLiveChatUtterance(text)
    ) {
      return ignoreSide(text, 'side_chat');
    }
    return { addressed: true, cleanText: text, reason: 'planning_gate' };
  }

  // „kannst du mir helfen“ + Tech ohne Travel → Side (außer Companion an Yorro)
  if (openFloor) {
    if (
      SIDE_CHAT_RE.test(text) &&
      !looksLikeAddressedAsk(text) &&
      !FOLLOW_NAV_RE.test(text)
    ) {
      return ignoreSide(text, 'side_chat');
    }
    if (FOLLOW_NAV_RE.test(core) || DIRECT_RE.test(core) || /\?/.test(text)) {
      try {
        const { looksLikeSmalltalkCompanion, markSmalltalkCompanion } = require('./smalltalkCompanionMode') as {
          looksLikeSmalltalkCompanion: (t: string) => boolean;
          markSmalltalkCompanion: (r?: string) => void;
        };
        if (looksLikeSmalltalkCompanion(text)) {
          markSmalltalkCompanion('open_floor');
          return { addressed: true, cleanText: text, reason: 'companion' };
        }
      } catch {
        /* soft */
      }
      // „kannst du mir helfen“ + Tech ohne Travel → Side
      if (
        DIRECT_RE.test(core) &&
        SIDE_TECH_RE.test(text) &&
        !TRAVEL_CTX_RE.test(text)
      ) {
        return ignoreSide(text, 'side_tech');
      }
      return { addressed: true, cleanText: text, reason: 'open_floor_direct' };
    }
    if (ACK_ONLY_RE.test(text)) {
      return { addressed: true, cleanText: text, reason: 'open_floor_ack' };
    }
    // Inhaltliche Aussagen: Open-Floor nimmt Concierge-Fragen an —
    // nur klare Side-Chat / Tech-ohne-Travel still.
    if (isSubstantiveLiveChatUtterance(text)) {
      if (SIDE_TECH_RE.test(text) && !TRAVEL_CTX_RE.test(text) && !/\?/.test(text)) {
        return ignoreSide(text, 'side_tech');
      }
      if (looksLikeSideHumanTalk(text) && !FOLLOW_NAV_RE.test(text) && !/\?/.test(text)) {
        return ignoreSide(text, 'open_floor_side');
      }
      return {
        addressed: true,
        cleanText: text,
        reason: 'open_floor_substantive',
      };
    }
    return { addressed: true, cleanText: text, reason: 'open_floor_follow' };
  }

  if (ACK_ONLY_RE.test(text)) {
    return { addressed: false, cleanText: text, reason: 'ack_only' };
  }

  if (SIDE_CHAT_RE.test(text) && !looksLikeAddressedAsk(text)) {
    return ignoreSide(text, 'side_chat');
  }

  if (
    SIDE_TECH_RE.test(text) &&
    !TRAVEL_CTX_RE.test(text) &&
    !NAME_ANYWHERE_RE.test(text)
  ) {
    // PTT ohne Live: Tech-Hilfe kann absichtlich an Yorro gehen —
    // nur ignorieren wenn schon Beside sticky (oben) oder klare Side-Vocative.
    // Hier: ohne Vocative durchlassen, außer reine Side-Muster oben.
  }

  if (FOLLOW_NAV_RE.test(core) || DIRECT_RE.test(core) || /\?/.test(text)) {
    return { addressed: true, cleanText: text, reason: 'direct_question' };
  }

  if (isSubstantiveLiveChatUtterance(text)) {
    return { addressed: true, cleanText: text, reason: 'substantive' };
  }

  return { addressed: true, cleanText: text, reason: 'open_turn' };
}
