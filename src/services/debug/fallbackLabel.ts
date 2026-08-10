/**
 * Sichtbare Fallback-Markierung — damit klar ist, WELCHER Pfad greift.
 * Spoken + Log + optional Store-Status.
 */

import { useFinnusStore } from '../../store/useFinnusStore';

/** Prefix für Speech/UI: „Fallback: <name> — …“ */
export function fallbackSpeech(kind: string, message: string): string {
  const k = (kind || 'unbekannt').trim();
  const m = (message || '').replace(/\s+/g, ' ').trim();
  const line = m ? `Fallback: ${k} — ${m}` : `Fallback: ${k}`;
  try {
    console.warn(`[fallback] ${k}`, m || undefined);
  } catch {
    /* soft */
  }
  try {
    useFinnusStore.getState().setTtsStatusMessage(line.slice(0, 120));
  } catch {
    /* soft */
  }
  return line;
}

/** Nur Log/Status, kein Speech-Text (interne Fallbacks). */
export function noteFallback(kind: string, detail?: string): void {
  const k = (kind || 'unbekannt').trim();
  const d = (detail || '').replace(/\s+/g, ' ').trim();
  try {
    console.warn(`[fallback] ${k}`, d || undefined);
  } catch {
    /* soft */
  }
  // Banner nur in Dev — Produktion soll keine Debug-Fallbacks zeigen
  if (!__DEV__) return;
  try {
    const line = d ? `Fallback: ${k} — ${d}` : `Fallback: ${k}`;
    useFinnusStore.getState().setTtsStatusMessage(line.slice(0, 120));
  } catch {
    /* soft */
  }
}
