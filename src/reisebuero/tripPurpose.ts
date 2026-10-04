/**
 * Trip-Titel vs. Wunsch-Schnipsel — Header/Purpose nie mit letzter Äußerung überschreiben.
 */

export function looksLikeTripTypePurpose(raw: string): boolean {
  const t = (raw || '').trim();
  if (t.length < 3) return false;
  return /\b(wochenende|städtetrip|staedtetrip|städtereise|staedtereise|familienurlaub|familienreise|urlaub|überraschung|ueberraschung|relaxen|familie|männer|maenner|jungs|paartrip|city.?trip|partywochenende)\b/iu.test(
    t,
  ) || /familien(?:urlaub|reise)|männerwochenende|maennerwochenende/iu.test(t);
}

export function looksLikeWishDumpPurpose(raw: string): boolean {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeTripTypePurpose(t)) return false;
  if (/^(ein |eine |bisschen |bitte |vielleicht )/iu.test(t)) return true;
  if (
    /\b(pool|bier|hotel|apartment|club|bitte haben|trinken)\b/iu.test(t) &&
    t.length <= 52 &&
    !/\b(urlaub|reise|wochenende)\b/iu.test(t)
  ) {
    return true;
  }
  return t.length > 48;
}

export function splitWishPhrases(raw: string): string[] {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t || /^(keine|nichts|nein)$/iu.test(t)) return [];
  return t
    .split(/\s*(?:,|;| und | sowie |\. )\s*/iu)
    .map((s) => s.replace(/^[\s\-–]+/, '').trim())
    .filter((s) => s.length >= 3 && s.length <= 48);
}
