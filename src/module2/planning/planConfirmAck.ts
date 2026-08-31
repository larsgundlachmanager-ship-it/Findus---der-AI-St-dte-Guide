/**
 * Kurze Ja/Nein-Acks während Modul-5 auf den User wartet.
 * Kein Stadt-Hardcode — nur Dialog-Tokens.
 */

export function isPlanConfirmYes(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(änder|aender|nein|nee|nö|nicht|später|spaeter)\b/i.test(t)
  ) {
    return false;
  }
  return /\b(ja|jo|jup|yes|yeah|passt|ok|okay|klar|mach|los|perfekt|genau|bestätig|bestaetig|weiter|laden|wechsel(?:n)?|datensatz)\b/i.test(
    t,
  );
}

export function isPlanConfirmNo(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(nein|nee|nö|nope|nicht|später|spaeter|pause|fertig|erstmal|reicht)\b/i.test(
    t,
  );
}

/** Nacktes Ja/Nein — nicht umschreiben, nicht als neues Thema. */
export function isBarePlanAck(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return /^(ja|jo|jup|yes|yeah|nein|nee|nö|nope|ok|okay|klar|passt|weiter|genau)[.!?]*$/i.test(
    t,
  );
}
