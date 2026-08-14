/**
 * Heuristik: Richtet sich die Äußerung an Findus oder an jemanden daneben?
 *
 * openFloor=true (nach Start / nach Antwort, innerhalb Idle):
 * freie Follow-ups ohne Namens-Keyword — z. B. „führ mich dahin“.
 *
 * Beside-Modus: User spricht mit einer anderen Person → still bis Wake/Name.
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

const WAKE_RE =
  /^(?:hey|hi|hallo|ok|okay|na|so)\s*,?\s*findus\b[,!.]?\s*/i;
const NAME_ANYWHERE_RE = /\bfindus\b/i;

/** Klare Concierge-Imperative / Fragen (auch ohne Namen). */
const DIRECT_RE =
  /^(?:was|wo|wie|wann|wer|welch(?:e[rsn]?)?|kannst|könntest|koenntest|zeig|führ|fuehr|bring|geh|lauf|navigier|erklär|erklaer|erzähl|erzaehl|such|finde|öffne|oeffne|stell|mach|plan|buch|reservier|erinner|wecker|wie\s+weit|wie\s+lange|und\s+dann|noch\s+was|mehr\s+dazu)\b/i;

/** Follow-up Navigation / Anapher ohne Keyword. */
const FOLLOW_NAV_RE =
  /\b(?:führ|fuehr|bring|geh|lauf|navigier|zeig).{0,40}\b(?:dahin|dort(?:hin)?|hin|mich|uns)\b|\b(?:dahin|dort(?:hin)?)\b.+\b(?:bitte|führ|fuehr|bring)\b|\b(?:ja\s+bitte|mach\s+das|los\s+geht|leg\s+los|start(?:e)?\s+(?:die\s+)?route|route\s+starten)\b/i;

/** Typischer Side-Chat / Anrede an andere Person. */
const SIDE_CHAT_RE =
  /\b(?:warte|komm(?:\s+her)?|schau\s+mal|guck\s+mal|ey\b|alter\b|digga|mein\s+freund|schatz|liebling|honey|babe|mama|papa|opa|oma|hör\s+mal|sag\s+mal\s+(?:du|mal)|weiß\s+du\s+was|weißt\s+du\s+was)\b/i;

/** Tech-/Alltags-Hilfe an jemanden daneben (ohne Findus-Name). */
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

export function isWakePhraseOnly(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!WAKE_RE.test(t) && !/^findus\b/i.test(t)) return false;
  const clean = stripLiveChatWakePrefix(t).replace(/^findus\b[,!.]?\s*/i, '');
  return clean.length < 2;
}

/** Planung wartet auf Sprache → jede sinnvolle Äußerung annehmen. */
function planningNeedsAnySpeech(): boolean {
  try {
    const { usePlanSessionStore } = require('../../module2/planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => {
          waitingLocation?: boolean;
          waitingConfirm?: boolean;
          waitingConflict?: boolean;
          active?: boolean;
          phase?: string;
        };
      };
    };
    const s = usePlanSessionStore.getState();
    if (s.waitingLocation || s.waitingConfirm || s.waitingConflict) return true;
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

function looksLikeSideHumanTalk(text: string): boolean {
  if (NAME_ANYWHERE_RE.test(text)) return false;
  if (SIDE_CHAT_RE.test(text) && !FOLLOW_NAV_RE.test(text)) return true;
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

  if (text.length < 2) {
    return { addressed: false, cleanText: '', reason: 'empty' };
  }

  if (WAKE_RE.test(text)) {
    clearBesideConversation('wake');
    const clean = stripLiveChatWakePrefix(text);
    if (clean.length < 2) {
      return { addressed: true, cleanText: '', reason: 'wake_only' };
    }
    return { addressed: true, cleanText: clean, reason: 'wake_prefix' };
  }

  if (NAME_ANYWHERE_RE.test(text)) {
    clearBesideConversation('name');
    const clean = text
      .replace(/\b(?:hey|hi|hallo)?\s*findus\b[,!.]?\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      addressed: true,
      cleanText: clean.length >= 2 ? clean : text,
      reason: 'name_mention',
    };
  }

  // Sticky Beside: nur noch per Name/Wake — außer klare Travel-Nav
  if (beside) {
    if (FOLLOW_NAV_RE.test(text) && TRAVEL_CTX_RE.test(text)) {
      clearBesideConversation('travel_follow');
      return { addressed: true, cleanText: text, reason: 'beside_travel_follow' };
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
      !/\?/.test(text) &&
      !isSubstantiveLiveChatUtterance(text)
    ) {
      return ignoreSide(text, 'side_chat');
    }
    return { addressed: true, cleanText: text, reason: 'planning_gate' };
  }

  // Offenes Gesprächsfenster: Follow-ups ohne Keyword — aber NICHT jeder Nebensatz
  if (openFloor) {
    if (SIDE_CHAT_RE.test(text) && !/\?/.test(text) && !FOLLOW_NAV_RE.test(text)) {
      return ignoreSide(text, 'side_chat');
    }
    if (FOLLOW_NAV_RE.test(text) || DIRECT_RE.test(text) || /\?/.test(text)) {
      // „kannst du mir helfen“ + Tech ohne Travel → Side
      if (
        DIRECT_RE.test(text) &&
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
    // Inhaltliche Aussagen nur wenn Travel/Concierge-Kontext — kein Side-Smalltalk
    if (isSubstantiveLiveChatUtterance(text)) {
      if (SIDE_TECH_RE.test(text) && !TRAVEL_CTX_RE.test(text)) {
        return ignoreSide(text, 'side_tech');
      }
      if (TRAVEL_CTX_RE.test(text) || DIRECT_RE.test(text) || /\?/.test(text)) {
        return {
          addressed: true,
          cleanText: text,
          reason: 'open_floor_substantive',
        };
      }
      // Ambiguous chatter nebenbei → Beside
      return ignoreSide(text, 'open_floor_ambient');
    }
    return { addressed: false, cleanText: text, reason: 'open_floor_ambiguous' };
  }

  if (ACK_ONLY_RE.test(text)) {
    return { addressed: false, cleanText: text, reason: 'ack_only' };
  }

  if (SIDE_CHAT_RE.test(text) && !/\?/.test(text)) {
    return ignoreSide(text, 'side_chat');
  }

  if (SIDE_TECH_RE.test(text) && !TRAVEL_CTX_RE.test(text) && !/\bfindus\b/i.test(text)) {
    // PTT ohne Live: Tech-Hilfe kann absichtlich an Findus gehen —
    // nur ignorieren wenn schon Beside sticky (oben) oder klare Side-Vocative.
    // Hier: ohne Vocative durchlassen, außer reine Side-Muster oben.
  }

  if (FOLLOW_NAV_RE.test(text) || DIRECT_RE.test(text) || /\?/.test(text)) {
    return { addressed: true, cleanText: text, reason: 'direct_question' };
  }

  if (isSubstantiveLiveChatUtterance(text)) {
    return { addressed: true, cleanText: text, reason: 'substantive' };
  }

  return { addressed: false, cleanText: text, reason: 'ambiguous_ignore' };
}
