/**
 * Heuristik: Richtet sich die Äußerung an Findus oder an jemanden daneben?
 *
 * openFloor=true (nach Start / nach Antwort, innerhalb Idle):
 * freie Follow-ups ohne Namens-Keyword — z. B. „führ mich dahin“.
 */

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
  /\b(?:warte|komm(?:\s+her)?|schau\s+mal|guck\s+mal|ey\b|alter\b|digga|mein\s+freund|schatz|liebling|mama|papa|hör\s+mal)\b/i;

const ACK_ONLY_RE =
  /^(?:ja|nein|nee|nö|no|hm+|mhm|aha|ok|okay|genau|stimmt|klar|cool|nice|super|danke|bitte)\.?$/i;

export function stripLiveChatWakePrefix(text: string): string {
  return text.replace(WAKE_RE, '').trim();
}

export function isWakePhraseOnly(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!WAKE_RE.test(t) && !/^findus\b/i.test(t)) return false;
  const clean = stripLiveChatWakePrefix(t).replace(/^findus\b[,!.]?\s*/i, '');
  return clean.length < 2;
}

export function classifyLiveChatAddress(
  raw: string,
  opts?: { openFloor?: boolean },
): LiveChatAddressResult {
  const text = raw.replace(/\s+/g, ' ').trim();
  const openFloor = opts?.openFloor === true;

  if (text.length < 2) {
    return { addressed: false, cleanText: '', reason: 'empty' };
  }

  if (WAKE_RE.test(text)) {
    const clean = stripLiveChatWakePrefix(text);
    if (clean.length < 2) {
      return { addressed: true, cleanText: '', reason: 'wake_only' };
    }
    return { addressed: true, cleanText: clean, reason: 'wake_prefix' };
  }

  if (NAME_ANYWHERE_RE.test(text)) {
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

  // Offenes Gesprächsfenster: Follow-ups ohne Keyword
  if (openFloor) {
    if (SIDE_CHAT_RE.test(text) && !/\?/.test(text) && !FOLLOW_NAV_RE.test(text)) {
      return { addressed: false, cleanText: text, reason: 'side_chat' };
    }
    if (FOLLOW_NAV_RE.test(text) || DIRECT_RE.test(text) || /\?/.test(text)) {
      return { addressed: true, cleanText: text, reason: 'open_floor_direct' };
    }
    if (ACK_ONLY_RE.test(text)) {
      // „ja“ / „bitte“ nach Angebot → an Findus
      return { addressed: true, cleanText: text, reason: 'open_floor_ack' };
    }
    // Freie Aussage im Fenster — behandeln, außer klar Side-Chat
    if (text.length >= 4) {
      return { addressed: true, cleanText: text, reason: 'open_floor' };
    }
  }

  if (ACK_ONLY_RE.test(text)) {
    return { addressed: false, cleanText: text, reason: 'ack_only' };
  }

  if (SIDE_CHAT_RE.test(text) && !/\?/.test(text)) {
    return { addressed: false, cleanText: text, reason: 'side_chat' };
  }

  if (FOLLOW_NAV_RE.test(text) || DIRECT_RE.test(text) || /\?/.test(text)) {
    return { addressed: true, cleanText: text, reason: 'direct_question' };
  }

  return { addressed: false, cleanText: text, reason: 'ambiguous_ignore' };
}
