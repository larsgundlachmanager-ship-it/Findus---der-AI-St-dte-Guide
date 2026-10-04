/**
 * Akt-2 Recap: Confirm vs Reject vs Additive (STT/Voice).
 * Rein — kein RN. „noch Pool dazu“ = additive, nicht Reject.
 * Word edges via \p{L} — JS \b bricht an Umlauten (ä/ö/ü).
 */

const WB = String.raw`(?:^|[^\p{L}\p{N}_])`;
const WE = String.raw`(?![\p{L}\p{N}_])`;

export const RECAP_CONFIRM_RE = new RegExp(
  `${WB}(ja|jo|passt|ok|klar|suche|final)${WE}`,
  'iu',
);

/** Explizites Ablehnen / Ändern / Neustart — bleibt Akt 2 außer Hard-Restart. */
export const RECAP_REJECT_RE = new RegExp(
  `${WB}(änder(?:n)?|aender(?:n)?|anders|korrigier|stopp|warte|nein|nicht\\s+so|doch|von\\s+vorne|neu\\s+anfangen)${WE}`,
  'iu',
);

/** Additive Patches auf dem Flipchart (bleiben Akt 2 / Recap). */
export const RECAP_ADD_RE = new RegExp(
  `${WB}(noch|zusätzlich|ausserdem|außerdem|und\\s+zwar|budget|euro|personen|apartment|all.?inclusive|pool|flug|bahn|montag|dienstag|donnerstag|freitag)${WE}`,
  'iu',
);

/** Hard restart → zurück Akt 1 (Briefing). */
export const RECAP_HARD_RESTART_RE = new RegExp(
  `${WB}(von\\s+vorne|neu\\s+anfang|komplett\\s+neu)${WE}`,
  'iu',
);

export function isRecapConfirm(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/^(ja|jo|passt|ok|klar|suche|final)([!.]?|\s+so)?$/iu.test(t)) return true;
  // Additive patches with a casual „ja“ are not confirm
  if (RECAP_ADD_RE.test(t) && !new RegExp(`${WB}(suche|starten|final)${WE}`, 'iu').test(t)) {
    return false;
  }
  return RECAP_CONFIRM_RE.test(t) && !RECAP_REJECT_RE.test(t) && t.length < 48;
}

/** Explicit reject / change / restart — not additive „noch …“. */
export function isRecapChange(text: string): boolean {
  return RECAP_REJECT_RE.test(text);
}

/**
 * Additive edit while on recap: add-patterns OR any non-confirm non-reject text.
 */
export function isRecapAdditive(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isRecapConfirm(t) || isRecapChange(t)) return false;
  return true;
}

export function isRecapHardRestart(text: string): boolean {
  return RECAP_HARD_RESTART_RE.test(text);
}

/** After ingest on additive path: also kick search? */
export function recapAdditiveWantsSearch(text: string): boolean {
  return new RegExp(`${WB}(suche|starten|final)${WE}`, 'iu').test(text);
}
