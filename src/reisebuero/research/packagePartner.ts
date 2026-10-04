/**
 * Pauschal-Partner (CHECK24, AIDU, Lidl, Magic Life, AIDA, …) = nur Buchungs-Links,
 * nie als Fake-Unterkunft in stays[].
 *
 * Wichtig: echte Hotels mit Check24-/Awin-Affiliate-URL sind KEIN Pauschal-Fake —
 * nur Name/ID/Why (oder nackte Portal-Suche ohne Hotelname) zählen.
 */

export function isPackagePartnerStay(s: {
  id?: string | null;
  name?: string | null;
  bookUrl?: string | null;
  why?: string | null;
}): boolean {
  const name = (s.name || '').trim();
  const id = (s.id || '').trim();
  const why = (s.why || '').trim();
  const url = (s.bookUrl || '').trim();
  const blob = `${id} ${name} ${why}`.toLowerCase();

  // Explizite Pauschal-/Portal-/Kreuzfahrt-Produkte am Namen
  if (
    /(?:^|[\s_-])(check24|ab-in-den-urlaub|abindenurlaub|lidl\s*reisen|magic\s*life|tui\s*magic|\baida\b|kreuzfahrt)(?:$|[\s_-])/i.test(
      blob,
    ) ||
    /\bpauschal\b.*\b(check24|urlaub|portal|partner|lidl|magic|aida)\b/i.test(blob) ||
    /\b(check24|lidl\s*reisen|magic\s*life|aida)\b.*\b(pauschal|kreuzfahrt)\b/i.test(blob)
  ) {
    return true;
  }
  if (
    /^pauschal\b/i.test(name) &&
    /check24|urlaub|portal|partner|lidl|magic|aida/i.test(name)
  ) {
    return true;
  }
  // Generische Portal-Labels ohne Hotelname
  if (
    /^(pauschal\s+)?(check24|ab-in-den-urlaub|lidl\s*reisen|magic\s*life|aida)\b/i.test(
      name,
    )
  ) {
    return true;
  }

  // URL allein reicht nur, wenn kein echter Hotelname da ist
  const packageUrl =
    /check24\.|ab-in-den-urlaub\.|abindenurlaub\.|lidl-reisen\.|magiclife\.|aida\.de|awin1\.com\/cread\.php.*(9364|9369|11773|15933|9144)/i.test(
      url,
    );
  if (packageUrl) {
    const looksLikeHotel =
      name.length >= 4 &&
      !/^pauschal\b/i.test(name) &&
      !/^(check24|ab-in-den|lidl|magic\s*life|tui\s*magic|aida|portal|partner|kreuzfahrt)\b/i.test(
        name,
      );
    if (looksLikeHotel) return false;
    return true;
  }
  return false;
}

export function filterRealStays<T extends { id?: string | null; name?: string | null; bookUrl?: string | null; why?: string | null }>(
  stays: T[] | null | undefined,
): T[] {
  return (stays ?? []).filter((s) => !isPackagePartnerStay(s));
}
