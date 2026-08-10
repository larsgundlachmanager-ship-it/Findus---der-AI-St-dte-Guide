/**
 * Multi-Intent Fan-out — Prefs zuerst persistieren, Rest an Router.
 * Verhindert, dass „Nenn mich nicht Bro und stell Wecker…“ die Pref verliert.
 */

import {
  extractPreferencesFast,
  runPreferenceCaptureMiddleware,
  type CapturedPreference,
} from '../memory/preferenceCaptureMiddleware';

export type IntentClauseKind =
  | 'preference'
  | 'wake'
  | 'shopping'
  | 'nav'
  | 'info'
  | 'other';

export type IntentClause = {
  text: string;
  kind: IntentClauseKind;
};

const SPLIT_RE =
  /\s*(?:,\s*|\bund\s+dann\b|\baußerdem\b|\bausserdem\b|\bdanach\b|\bzuerst\b|\bund\s+noch\b|\bsowie\b|\b;\s*)\s*/iu;

function classifyClause(text: string): IntentClauseKind {
  const t = text.replace(/\s+/g, ' ').trim();
  if (
    extractPreferencesFast(t).length > 0 ||
    /\b(?:nenn\s+mich|merk\s+dir|bitte\s+nicht|sag\s+nicht)\b/iu.test(t)
  ) {
    return 'preference';
  }
  if (
    /\b(?:wecker|aufstehen|weck\s+mich|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?wecker)\b/iu.test(
      t,
    )
  ) {
    return 'wake';
  }
  if (
    /\b(?:kauf|hol|besorg|einkauf|zahnbürste|zahnbuerste|dm\b|rossmann|erinner\s+mich)\b/iu.test(
      t,
    )
  ) {
    return 'shopping';
  }
  if (
    /\b(?:bring\s+mich|führ\s+mich|fuehr\s+mich|navigier|weg\s+zu|zum\s+hotel)\b/iu.test(
      t,
    )
  ) {
    return 'nav';
  }
  if (
    /\b(?:wann|öffnung|oeffnung|frühstück|fruehstueck|gibt\s+es|wie\s+viel|kosten)\b/iu.test(
      t,
    )
  ) {
    return 'info';
  }
  return 'other';
}

/** Zerlegt Multi-Intent-Sätze in Klauseln. */
export function splitMultiIntentClauses(text: string): IntentClause[] {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw
    .split(SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (parts.length <= 1) {
    return [{ text: raw, kind: classifyClause(raw) }];
  }
  return parts.map((p) => ({ text: p, kind: classifyClause(p) }));
}

export type FanoutResult = {
  prefs: CapturedPreference[];
  replyHint: string | null;
  /** Text ohne Pref-Klauseln — für weiter Router */
  remainingText: string;
  /** Nur Prefs, nichts anderes → Intent kann enden */
  onlyPreferences: boolean;
  clauses: IntentClause[];
};

/**
 * Pref-Klauseln sofort persistieren; Rest an Intent-/Concierge weiterreichen.
 */
export async function runMultiIntentPreferenceFanout(
  text: string,
): Promise<FanoutResult> {
  const clauses = splitMultiIntentClauses(text);
  const prefClauses = clauses.filter((c) => c.kind === 'preference');
  const otherClauses = clauses.filter((c) => c.kind !== 'preference');

  // Immer ganzen Satz durch Middleware (fängt auch Einzeiler)
  const mid = await runPreferenceCaptureMiddleware(text);

  const remainingText =
    otherClauses.length > 0
      ? otherClauses.map((c) => c.text).join('. ')
      : prefClauses.length && clauses.length === 1
        ? ''
        : text;

  const onlyPreferences =
    mid.prefs.length > 0 &&
    (otherClauses.length === 0 ||
      (clauses.length === 1 && clauses[0]?.kind === 'preference'));

  return {
    prefs: mid.prefs,
    replyHint: mid.replyHint,
    remainingText: remainingText.trim(),
    onlyPreferences,
    clauses,
  };
}

/** Anti-Halluzination Prompt-Block (Öffnungszeiten etc.). */
export function antiHallucinationPromptBlock(): string {
  return [
    '=== ANTI-HALLUZINATION (STRENG) ===',
    '- Öffnungszeiten, Frühstückszeiten, Preise, Abfahrten: NUR aus Tools/Live-Daten.',
    '- Wenn keine Live-Daten: ehrlich sagen und Recherche anbieten — NICHT schätzen oder erfinden.',
    '- Keine erfundenen Hotel-Frühstückszeiten („bestimmt 7–10“).',
  ].join('\n');
}
