/**
 * Hard-Guardrails — Code > KI.
 * SYNCHRON, kein LLM, kein await → ~0 ms Zusatz-Latenz vor TTS/UI.
 * Deterministische Filter. Die KI hat hier kein Mitspracherecht.
 */

import type { GeminiConciergeResponse } from '../../types/concierge';
import type { QuickAction } from '../../types/concierge';
import { stripPermissionAsksWhenActionsReady } from '../concierge/justDoItPolicy';

export const SPEECH_MAX_CHARS = 600;
/** Marker: Guardrails sind sync / Early (vor TTS). */
export const GUARDRAILS_SYNC = true as const;

const URL_RE = /https?:\/\/\S+|www\.\S+/giu;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/giu;
/** PLZ DE/AT/CH + optional Ort */
const PLZ_RE = /\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*/gu;
const STREET_NUM_RE =
  /\b(?:straße|strasse|str\.|weg|allee|platz|gasse)\s+\w[\w\-]*(?:\s+\d{1,4}[a-zA-Z]?)?/giu;
const COUNTRY_DE_RE = /\bDeutschland\b/giu;
const FILLER_OPEN_RE =
  /^(Okay,?\s+hier\s+ist\s+(?:dein|das)\s+Ergebnis[.!]?\s*|Also,?\s+hier\s+(?:kommt|ist)[.!]?\s*|Zusammengefasst:\s*)/iu;

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
 * Scrub speechText: Adressen, URLs, PLZ, Länder, Länge, Füllphrasen.
 * userText optional: wenn User explizit Adresse will → Adress-Filter aus.
 */
export function scrubSpeechForTts(
  speech: string,
  opts?: { userAskedAddress?: boolean; maxChars?: number },
): { text: string; notes: string[] } {
  const notes: string[] = [];
  let s = speech.trim();
  if (!s) return { text: s, notes };

  const before = s;

  s = s.replace(URL_RE, '');
  s = s.replace(EMAIL_RE, '');
  if (s !== before.replace(URL_RE, '').replace(EMAIL_RE, '') || /https?:\/\//i.test(before)) {
    if (/https?:\/\/|www\./i.test(before)) notes.push('urls_stripped');
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
    // Am Satzende kürzen
    let cut = s.slice(0, max);
    const lastStop = Math.max(
      cut.lastIndexOf('.'),
      cut.lastIndexOf('!'),
      cut.lastIndexOf('?'),
    );
    if (lastStop > max * 0.45) cut = cut.slice(0, lastStop + 1);
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
  let t = label.trim().replace(URL_RE, '');
  if (t.length > 30) t = t.slice(0, 30).replace(/\s+\S*$/, '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 4) t = words.slice(0, 4).join(' ');
  return t.slice(0, 30);
}

function actionLooksDead(a: QuickAction): boolean {
  if (a.type === 'OPEN_URL' && !a.payload.url?.trim()) return true;
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
  const userAskedAddress = /\b(adresse|hausnummer|plz|wo\s+genau|welche\s+straße|welche\s+strasse)\b/iu.test(
    opts?.userText ?? '',
  );

  const scrubbed = scrubSpeechForTts(response.speechText, { userAskedAddress });
  let speechText = scrubbed.text;
  notes.push(...scrubbed.notes);

  speechText = stripPermissionAsksWhenActionsReady(
    speechText,
    response.quickActions,
  );

  const bulletsRaw = (response.visualBullets ?? []).slice(0, 3).map(clampBullet);
  const visualBullets = bulletsRaw.filter(Boolean);
  if (visualBullets.length !== (response.visualBullets ?? []).length) {
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
  if (commitsNav && !hasNav && !userWantsNav) {
    speechText = speechText
      .replace(
        /[^.?!]*\b(ich\s+(führ|fuehr|bring)(?:e|en)?|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+startet)[^.?!]*[.?!]\s*/giu,
        '',
      )
      .trim();
    notes.push('unsolicited_nav_speech_stripped');
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
