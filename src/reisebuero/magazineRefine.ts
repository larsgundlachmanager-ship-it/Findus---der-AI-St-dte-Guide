/**
 * Akt-4 Magazin Mic-Refine — kurzes Ack, kein Briefing-Katalog.
 * Struktur-Blaupause, Wortlaut frei.
 */

import type { ReiseLedger } from './types';
import { composeRecapPatchAck } from './recapSpeech';

/** User will die Suche neu anstoßen. */
export function magazineWantsResearchAgain(text: string): boolean {
  return /\b(neu\s+suchen|nochmal\s+suchen|andere\s+(?:ideen?|optionen?|st[aä]dte)|neu\s+planen|frisch\s+suchen|noch\s+mal\s+recherchieren)\b/iu.test(
    text || '',
  );
}

/**
 * Kurzes Feedback-Ack im offenen Magazin.
 * Kein Slot-Ablesen, kein „nächste Katalogfrage“.
 */
export function composeMagazineRefineAck(ledger: ReiseLedger, _userText?: string): string {
  return composeRecapPatchAck(ledger).replace(
    /Passt das so[^.]*\?/i,
    'Soll ich mit dem geänderten Brief neu suchen — oder reicht der Feinschliff so?',
  );
}
