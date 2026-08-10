/**
 * Hard-Guardrails — Code > KI.
 * SYNCHRON, kein LLM, kein await → ~0 ms Zusatz-Latenz vor TTS/UI.
 * Deterministische Filter. Die KI hat hier kein Mitspracherecht.
 */

import type { GeminiConciergeResponse } from '../../types/concierge';
import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { stripPermissionAsksWhenActionsReady } from '../concierge/justDoItPolicy';
import { stripStageDirections } from '../g2p/germanTtsProsodyRules';
import {
  filterAddressCoordBullets,
  userAskedForAddressOrCoords,
} from '../../utils/addressPrivacy';
import { isProtectedDot } from '../audio/punctuationChunker';

export const SPEECH_MAX_CHARS = 600;
/** Explizite Stadtgeschichte / lange Narrative (Nachfrage) — mind. genug Platz für ~1000+. */
export const SPEECH_MAX_CHARS_HISTORY = 2200;
/** Marker: Guardrails sind sync / Early (vor TTS). */
export const GUARDRAILS_SYNC = true as const;

const HISTORY_SPEECH_RE =
  /\b(geschichte\s+von|erzähl(?:e|)\s+(?:mir\s+)?(?:die\s+)?geschichte|historie|entstehung|chronik|britzerdorpe|peiner\s+hof|goldschätzchen|goldschaetzchen|entwickelt|über\s+die\s+jahre|fun\s*facts?)\b/iu;

export function resolveSpeechMaxChars(userText?: string, speech?: string): number {
  const blob = `${userText ?? ''} ${speech ?? ''}`.slice(0, 800);
  if (HISTORY_SPEECH_RE.test(blob)) return SPEECH_MAX_CHARS_HISTORY;
  // Lange vorgebaute Narrative (Stadtgeschichte)
  if ((speech?.length ?? 0) > 700 && /\b(1342|urkunde|jahrhundert|heute:)\b/i.test(speech ?? '')) {
    return SPEECH_MAX_CHARS_HISTORY;
  }
  return SPEECH_MAX_CHARS;
}

const URL_RE = /https?:\/\/\S+|www\.\S+/giu;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/giu;
/** PLZ DE/AT/CH + optional Ort */
const PLZ_RE = /\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*/gu;
const STREET_NUM_RE =
  /\b(?:straße|strasse|str\.|weg|allee|platz|gasse)\s+\w[\w\-]*(?:\s+\d{1,4}[a-zA-Z]?)?/giu;
const COUNTRY_DE_RE = /\bDeutschland\b/giu;
/** Dezimal-Koordinaten (nie vorlesen) */
const COORD_PAIR_RE =
  /\b-?\d{1,3}\.\d{3,}\s*[,;/\s]\s*-?\d{1,3}\.\d{3,}\b/gu;
const ORT_BEI_COORD_RE =
  /\bort\s+bei\s+-?\d{1,3}\.\d{2,}(?:\s*,\s*-?\d{1,3}\.\d{2,})?/giu;
const FILLER_OPEN_RE =
  /^(Okay,?\s+hier\s+ist\s+(?:dein|das)\s+Ergebnis[.!]?\s*|Also,?\s+hier\s+(?:kommt|ist)[.!]?\s*|Zusammengefasst:\s*)/iu;

/** Interne Meta-Zeilen, die nie vorgelesen werden dürfen. */
const INTERNAL_META_RE =
  /(?:^|\n)\s*(?:Speech\s*text|Card\s*title|Visual\s*bullets|Quick\s*actions|Type|Payload|Label|target\s*point|Notiert|STADT[_ ]?KONTEXT[^\n]*)\s*:?\s*[^\n]*/giu;

const INTERNAL_PHRASE_RE =
  /\b(?:Kurz\s+zu(?:\s+[„"][^„"]*[„"])?[^.!?]{0,120}[.!?]?|Ich\s+habe\s+die\s+Teile\s+geprüft[.!]?|Hab(?:e)?\s+die\s+Teile\s+geprüft[.!]?|die\s+Teile\s+geprüft[.!]?|STADT[_ ]?KONTEXT[_\w]*|Notiert:\s*\S+)\s*/giu;

const STANDALONE_CHECK_RE =
  /(?:^|[.!?]\s+)Check\.?(?=\s|$)/giu;

export type GuardrailReport = {
  speechChanged: boolean;
  bulletsChanged: boolean;
  actionsChanged: boolean;
  notes: string[];
};

function collapseWs(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

/**
 * Deterministisch: gängige DE-Abkürzungen für TTS ausschreiben.
 * Läuft nur auf Speech-Text (URLs/E-Mails sind vorher entfernt).
 * Action-Labels / UI-Chips werden hier nicht angefasst.
 */
export function expandGermanAbbreviationsForSpeech(speech: string): string {
  let t = speech;
  if (!t) return t;

  const unitWord = (
    raw: string,
    singular: string,
    plural: string,
  ): string => {
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) && n === 1 ? singular : plural;
  };

  // Einheiten mit Zahl zuerst (km vor m; Min/Std vor Freitext-Kürzeln)
  t = t.replace(
    /\b(\d+(?:[.,]\d+)?)\s*km\/h\b/gi,
    '$1 Kilometer pro Stunde',
  );
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*km\b/gi, '$1 Kilometer');
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:Mins?|mins?)\b/g, (_, n) => {
    return `${n} ${unitWord(n, 'Minute', 'Minuten')}`;
  });
  t = t.replace(
    /\b(\d+(?:[.,]\d+)?)\s*Min\.?(?=\s|$|[,;:!?…])/g,
    (_, n) => `${n} ${unitWord(n, 'Minute', 'Minuten')}`,
  );
  t = t.replace(
    /\b(\d+(?:[.,]\d+)?)\s*min\.?(?=\s|$|[,;:!?…])/g,
    (_, n) => `${n} ${unitWord(n, 'Minute', 'Minuten')}`,
  );
  t = t.replace(
    /\b(\d+(?:[.,]\d+)?)\s*Std\.?(?=\s|$|[,;:!?…])/gi,
    (_, n) => `${n} ${unitWord(n, 'Stunde', 'Stunden')}`,
  );
  // Distanz-Meter: „500 m“ / „500m“ — `\b` verhindert „am“/„mm“
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*m\b/g, '$1 Meter');

  // Währung
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*€/g, '$1 Euro');
  t = t.replace(/€\s*(\d+(?:[.,]\d+)?)/g, '$1 Euro');
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*EUR\b/gi, '$1 Euro');

  // Freitext-Abkürzungen
  t = t.replace(/\bbzw\.\s*/gi, 'beziehungsweise ');
  t = t.replace(/\bz\.\s*B\.\s*/g, 'zum Beispiel ');
  t = t.replace(/\bz\.\s*b\.\s*/g, 'zum Beispiel ');
  t = t.replace(/\bca\.\s*/gi, 'circa ');
  t = t.replace(/\busw\.\s*/gi, 'und so weiter ');
  t = t.replace(/\betc\.?(?=\s|$|[,;:!?…])/gi, 'und so weiter');
  t = t.replace(/\bu\.\s*a\.\s*/gi, 'unter anderem ');
  t = t.replace(/\bd\.\s*h\.\s*/gi, 'das heißt ');
  t = t.replace(/\bo\.\s*[Ää]\.\s*/g, 'oder Ähnliches ');

  return t;
}

/**
 * Scrub speechText: Adressen, URLs, PLZ, Länder, Länge, Füllphrasen.
 * userText optional: wenn User explizit Adresse will → Adress-Filter aus.
 */
export function scrubSpeechForTts(
  speech: string,
  opts?: {
    userAskedAddress?: boolean;
    maxChars?: number;
    /** Nur URL/E-Mail — für universellen TTS-Pfad (Nav braucht Straßennamen). */
    urlsAndEmailsOnly?: boolean;
  },
): { text: string; notes: string[] } {
  const notes: string[] = [];
  let s = speech.trim();
  if (!s) return { text: s, notes };

  const before = s;

  // Interne Debug-/Karten-Meta nie vorlesen
  if (INTERNAL_META_RE.test(s) || INTERNAL_PHRASE_RE.test(s) || STANDALONE_CHECK_RE.test(s)) {
    notes.push('internal_meta_stripped');
  }
  s = s.replace(INTERNAL_META_RE, ' ');
  s = s.replace(INTERNAL_PHRASE_RE, ' ');
  s = s.replace(STANDALONE_CHECK_RE, (m) => (m.startsWith('.') || m.startsWith('!') || m.startsWith('?') ? m[0]! : ' '));
  s = s.replace(/\bCheck\.(?=\s|$)/giu, ' ');

  // Cartesia-/IPA-Leaks nie vorlesen oder in Untertiteln zeigen
  if (/<<[^>]*>>|⟦[^⟧]*⟧|\[[ˈˌ]/.test(s)) {
    notes.push('ipa_spans_stripped');
  }
  s = s.replace(/<<[^>]*>>/g, ' ');
  s = s.replace(/⟦[^⟧]*⟧/g, ' ');
  s = s.replace(/\[[ˈˌ][^\]\n]{0,80}\]/g, ' ');

  // Pack-Himmelsrichtungen in Teasern für Fußgänger streichen (nur diese Phrasen)
  const beforeCardinals = s;
  s = s.replace(
    /\bwenn\s+du\s+von\s+(?:norden|süden|osten|westen|nordwest(?:en)?|nordost(?:en)?|südwest(?:en)?|südost(?:en)?)\s+kommst[,:]?\s*/giu,
    '',
  );
  s = s.replace(
    /\b(?:von\s+)?(?:norden|süden|osten|westen)\s+kommst\b/giu,
    'du kommst',
  );
  if (s !== beforeCardinals) notes.push('cardinals_scrubbed');

  // Regie nie vorlesen (*flüstert*, Stimme senkt sich, Cartesia-Kommandos, …)
  s = stripStageDirections(s);

  s = s.replace(URL_RE, '');
  s = s.replace(EMAIL_RE, '');
  if (COORD_PAIR_RE.test(before) || ORT_BEI_COORD_RE.test(before)) {
    notes.push('coords_stripped');
  }
  s = s.replace(COORD_PAIR_RE, '');
  s = s.replace(ORT_BEI_COORD_RE, 'hier');
  if (s !== before.replace(URL_RE, '').replace(EMAIL_RE, '') || /https?:\/\//i.test(before)) {
    if (/https?:\/\/|www\./i.test(before)) notes.push('urls_stripped');
  }

  // Abkürzungen → Vollformen (auch im universellen TTS-Pfad)
  const beforeAbbr = s;
  s = expandGermanAbbreviationsForSpeech(s);
  if (s !== beforeAbbr) notes.push('abbr_expanded');

  if (opts?.urlsAndEmailsOnly) {
    s = collapseWs(s);
    const maxOnly = opts.maxChars ?? 16_000;
    if (s.length > maxOnly) {
      s = `${s.slice(0, maxOnly).trim()}…`;
      notes.push('truncated_tts');
    }
    return { text: s, notes };
  }

  if (!opts?.userAskedAddress) {
    const prev = s;
    s = s.replace(PLZ_RE, '');
    s = s.replace(STREET_NUM_RE, '');
    s = s.replace(COUNTRY_DE_RE, '');
    // „in 26486 Wangerooge“-ähnlich
    s = s.replace(/\b\d{5}\b/g, '');
    if (s !== prev) notes.push('address_stripped');
  }

  s = s.replace(FILLER_OPEN_RE, '');
  if (FILLER_OPEN_RE.test(before)) notes.push('filler_stripped');

  s = collapseWs(s);

  const max = opts?.maxChars ?? SPEECH_MAX_CHARS;
  if (s.length > max) {
    // Am echten Satzende kürzen — nie an ca./Dr./z.B.
    let cut = s.slice(0, max);
    let lastStop = -1;
    for (let i = cut.length - 1; i >= Math.floor(max * 0.45); i--) {
      const ch = cut[i]!;
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      if (ch === '.' && isProtectedDot(cut, i)) continue;
      lastStop = i;
      break;
    }
    if (lastStop >= 0) cut = cut.slice(0, lastStop + 1);
    else cut = `${cut.trim().replace(/[,:;–—\-]+$/, '')}…`;
    s = cut.trim();
    notes.push('truncated_600');
  }

  return { text: s, notes };
}

function clampBullet(b: string): string {
  let t = b.trim();
  t = t.replace(URL_RE, '').replace(EMAIL_RE, '');
  t = t.replace(COUNTRY_DE_RE, '');
  t = t.replace(PLZ_RE, '');
  t = t.replace(COORD_PAIR_RE, '');
  t = t.replace(ORT_BEI_COORD_RE, '');
  // Keine ganzen Sätze → am ersten .! ? schneiden wenn zu lang
  if (/[.!?].+\w/.test(t) && t.length > 48) {
    const m = t.match(/^[^.!?]{8,48}[.!?]?/);
    if (m) t = m[0].replace(/[.!?]$/, '').trim();
  }
  // Max ~8 Wörter
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 8) t = words.slice(0, 8).join(' ');
  return collapseWs(t);
}

function clampActionLabel(label: string): string {
  const t = label.trim().replace(URL_RE, '').replace(/\s+/g, ' ');
  // Max 30 Zeichen — Emoji + Kurzformen (Route, Karte, Web, …)
  return shortenActionLabel(t);
}

function actionLooksDead(a: QuickAction): boolean {
  if (a.type === 'OPEN_URL') {
    const url = (a.payload.url ?? '').trim();
    if (!url) return true;
    if (/network[_.\s-]?error|404|undefined|null|example\.com/i.test(url)) {
      return true;
    }
    if (/^web:\s*network/i.test(a.label) || /network[_.\s-]?error/i.test(a.label)) {
      return true;
    }
  }
  if (a.type === 'DIAL_PHONE' && !a.payload.phoneNumber?.trim()) return true;
  if (
    a.type === 'START_NAVIGATION' &&
    a.payload.targetPoiId == null &&
    a.payload.destLat == null &&
    !a.payload.destName?.trim()
  ) {
    return true;
  }
  return false;
}

/**
 * Vollständige Hard-Guardrail-Pipeline auf Concierge-Response.
 * Rein synchron — kein LLM, kein Network (Early Guardrails, 0 ms Extra-Latenz).
 */
export function applyHardGuardrails(
  response: GeminiConciergeResponse,
  opts?: { userText?: string },
): { response: GeminiConciergeResponse; report: GuardrailReport } {
  const notes: string[] = [];
  const userAskedAddress = userAskedForAddressOrCoords(opts?.userText ?? '');

  const scrubbed = scrubSpeechForTts(response.speechText, {
    userAskedAddress,
    maxChars: resolveSpeechMaxChars(opts?.userText, response.speechText),
  });
  let speechText = scrubbed.text;
  notes.push(...scrubbed.notes);

  speechText = stripPermissionAsksWhenActionsReady(
    speechText,
    response.quickActions,
  );

  const bulletsRaw = filterAddressCoordBullets(
    (response.visualBullets ?? []).slice(0, 3).map(clampBullet),
    { allowAddress: userAskedAddress },
  ).filter(Boolean);
  const visualBullets = bulletsRaw;
  if (visualBullets.join('|') !== (response.visualBullets ?? []).join('|')) {
    notes.push('bullets_clamped');
  }

  let quickActions = (response.quickActions ?? [])
    .filter((a) => !actionLooksDead(a))
    .map((a) => ({
      ...a,
      label: clampActionLabel(a.label || a.type),
    }));

  if (quickActions.length !== (response.quickActions ?? []).length) {
    notes.push('dead_actions_removed');
  }

  // speechCommits to nav without button → strip commit phrasing soft
  const commitsNav =
    /\b(ich\s+(führ|fuehr|bring)|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+startet)\b/iu.test(
      speechText,
    );
  const hasNav = quickActions.some((a) => a.type === 'START_NAVIGATION');
  const userWantsNav = /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route\s+zu|lass\s+uns\s+zum)\b/iu.test(
    opts?.userText ?? '',
  );
  if ((commitsNav || /\bich\s+starte\s+die\s+navigation\b/iu.test(speechText)) && !userWantsNav) {
    speechText = speechText
      .replace(
        /[^.?!]*\b(ich\s+starte\s+die\s+navigation|ich\s+(führ|fuehr|bring)(?:e|en)?|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+startet)[^.?!]*[.?!]\s*/giu,
        '',
      )
      .trim();
    notes.push('unsolicited_nav_speech_stripped');
    // Historie-Antwort: Nav-Button behalten, aber nicht auto-starten via Speech
    if (!hasNav) {
      /* ok */
    }
  }

  const report: GuardrailReport = {
    speechChanged: speechText !== response.speechText.trim(),
    bulletsChanged: visualBullets.join('|') !== (response.visualBullets ?? []).join('|'),
    actionsChanged: quickActions.length !== (response.quickActions ?? []).length,
    notes,
  };

  return {
    response: {
      ...response,
      speechText,
      visualBullets,
      quickActions,
      cardTitle: response.cardTitle?.trim().slice(0, 48) || response.cardTitle,
    },
    report,
  };
}

/** Alias: betont synchrone Early-Guardrails (Streaming/TTS-Pfad). */
export const applyHardGuardrailsSync = applyHardGuardrails;
