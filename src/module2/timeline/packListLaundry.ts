/**
 * Waschmaschine für Packliste — Beleg aus Text/Unterkunft, keine User-Frage.
 */

export function detectLaundryFromEvidence(blob: string): 'yes' | 'no' | 'unknown' {
  const t = String(blob || '');
  if (!t.trim()) return 'unknown';
  const laundry =
    /\b(waschmaschine|wäsche\s+waschen|waesche\s+waschen|waschsalon|laundry|washer|washing\s*machine|self[\s-]?service\s*laundry|guest\s*laundry)\b/iu.test(
      t,
    );
  if (
    /\b(keine?\s+waschmaschine|kein\s+waschen|ohne\s+wasch|no\s+laundry|laundry\s+not\s+available|nicht\s+vorhanden)\b/iu.test(
      t,
    ) ||
    (laundry && /\b(nein|kein|ohne|not\s+available|unavailable)\b/iu.test(t))
  ) {
    return 'no';
  }
  if (
    laundry &&
    /\b(ja|haben|gibt|vor\s+ort|im\s+hotel|apartment|available|included|vorhanden|nutzung)\b/iu.test(
      t,
    )
  ) {
    return 'yes';
  }
  if (laundry) return 'yes'; // Erwähnung = Beleg vorhanden
  return 'unknown';
}

/** User will nicht waschen — auch wenn Maschine da ist. */
export function looksLikeRefuseLaundry(text: string): boolean {
  const t = String(text || '');
  return (
    /\b(will\s+nicht\s+wasch|nicht\s+waschen|ohne\s+waschen|keine\s+wäsche|keine\s+waesche|waschmaschine\s*:\s*nein|keine\s+waschmaschine)\b/iu.test(
      t,
    ) ||
    (/\bwaschmaschine\b/iu.test(t) &&
      /\b(nein|nicht|ohne|egal)\b/iu.test(t) &&
      /\b(packen|packliste|rechnen|shirts?)\b/iu.test(t))
  );
}

export function looksLikeConfirmLaundry(text: string): boolean {
  const t = String(text || '');
  return (
    /\b(waschmaschine\s*:\s*ja|waschmaschine\s+ja|mit\s+waschmaschine|werde\s+waschen|wäsche\s+machen)\b/iu.test(
      t,
    ) ||
    (/\bwaschmaschine\b/iu.test(t) &&
      /\b(ja|haben|gibt)\b/iu.test(t) &&
      /\b(packen|packliste|rechnen)\b/iu.test(t))
  );
}
