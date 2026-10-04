/**
 * Speech-Preis = Bullet-Preis = belegter Hint — kein Fake-Preis nur in Audio.
 */

export function syncPriceEvidence(opts: {
  speech: string;
  bullets: string[];
  dishPriceHint?: string | null;
  allowPriceInBullets?: boolean;
}): { speech: string; bullets: string[] } {
  const hint = String(opts.dishPriceHint || "").trim();
  const allow = opts.allowPriceInBullets !== false;
  let bullets = [...(opts.bullets || [])].map((b) => String(b || "").trim()).filter(Boolean);
  let speech = String(opts.speech || "");

  const priceRe = /\b\d{1,4}\s*€|\b\d{1,4}\s*euro\b/iu;
  if (hint && allow) {
    if (!bullets.some((b) => priceRe.test(b) || b.includes(hint.slice(0, 12)))) {
      bullets = [hint, ...bullets].slice(0, 3);
    }
    if (!priceRe.test(speech) && !speech.includes(hint.slice(0, 12))) {
      speech = `${speech} ${hint}.`.replace(/\s+/g, " ").trim();
    }
  } else if (!hint) {
    // Kein Beleg → Preise aus Speech/Bullets streichen (Fake-Schutz)
    speech = speech
      .replace(/\b(?:ca\.?\s*)?\d{1,4}\s*(?:€|euro)\b/giu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    bullets = bullets.filter((b) => !priceRe.test(b) || /live|belegt|website/i.test(b));
  }

  return { speech, bullets: bullets.slice(0, 3) };
}
