/**
 * Zwei Pitch-Optionen: erste Stichpunkte müssen sich unterscheiden.
 * Innerhalb einer Karte: Gericht nicht 3× (Menü / Gericht / Preis).
 */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Gericht-Stamm aus Stichpunkt (ohne Preis). */
function dishStem(b: string): string | null {
  const t = norm(b)
    .replace(/^men[üu]:\s*/i, '')
    .replace(/\s*[:~]?\s*\d+[.,]?\d*\s*€.*$/i, '')
    .replace(/\s*gericht\b/gi, '')
    .trim();
  if (t.length < 3) return null;
  if (/^\d/.test(t) || /\b(km|m)\b/.test(t)) return null;
  return t.slice(0, 24);
}

/** Pro Karte: ein Gericht-Stichpunkt (mit Preis wenn da), Rest Vibe/Distanz. */
export function collapseDishBullets(
  bullets: string[],
  dishPriceHint?: string | null,
): string[] {
  const price = String(dishPriceHint || '').trim();
  const out: string[] = [];
  let dishKept = false;
  if (price) {
    out.push(price.replace(/\s*~\s*/g, ': ').replace(/\s+/g, ' '));
    dishKept = true;
  }
  for (const raw of bullets) {
    const b = String(raw || '').trim();
    if (!b) continue;
    const stem = dishStem(b);
    const isDishy =
      stem &&
      (/pann|steak|angus|fisch|pizza|sushi|burger|döner|doener|schnitzel|pasta/i.test(
        stem,
      ) ||
        /^men[üu]:/i.test(b) ||
        /gericht/i.test(b));
    if (isDishy) {
      if (dishKept) continue;
      out.push(b.includes('€') ? b : b);
      dishKept = true;
      continue;
    }
    if (out.some((x) => norm(x) === norm(b))) continue;
    out.push(b);
  }
  return out.slice(0, 3);
}

export function diversifyPitchBullets(
  cards: Array<{
    bullets: string[];
    candidate: {
      softTags?: string[];
      hookNotes?: string[];
      dishPriceHint?: string | null;
      distFromAnchorM?: number | null;
      rating?: number | null;
    };
  }>,
): void {
  for (const card of cards) {
    card.bullets = collapseDishBullets(
      card.bullets,
      card.candidate.dishPriceHint,
    );
  }
  if (cards.length < 2) return;
  const a = cards[0]!;
  const b = cards[1]!;
  const sharedFirst =
    a.bullets[0] &&
    b.bullets[0] &&
    norm(a.bullets[0]) === norm(b.bullets[0]);
  if (!sharedFirst) return;
  const pickAlt = (
    card: (typeof cards)[0],
    other: string[],
  ): string | null => {
    const pool = [
      card.candidate.dishPriceHint,
      ...(card.candidate.hookNotes ?? []),
      ...(card.candidate.softTags ?? []),
      card.candidate.rating != null && card.candidate.rating >= 4.3
        ? `${card.candidate.rating.toFixed(1).replace('.', ',')}★ Gefühl`
        : null,
      card.candidate.distFromAnchorM != null
        ? card.candidate.distFromAnchorM < 1000
          ? `${Math.round(card.candidate.distFromAnchorM / 50) * 50} m`
          : `rund ${Math.max(1, Math.round(card.candidate.distFromAnchorM / 1000))} km`
        : null,
      ...card.bullets.slice(1),
    ]
      .map((x) => String(x || '').trim())
      .filter((x) => x.length >= 3);
    const otherN = new Set(other.map(norm));
    return pool.find((p) => !otherN.has(norm(p))) ?? null;
  };
  const altA = pickAlt(a, b.bullets);
  const altB = pickAlt(b, a.bullets);
  if (altA && norm(altA) !== norm(a.bullets[0]!)) {
    a.bullets = [altA, ...a.bullets.filter((x) => norm(x) !== norm(altA))].slice(
      0,
      3,
    );
  }
  if (altB && norm(altB) !== norm(b.bullets[0]!)) {
    b.bullets = [altB, ...b.bullets.filter((x) => norm(x) !== norm(altB))].slice(
      0,
      3,
    );
  }
}
