/**
 * Welcome-Speech Qualität — Lexikon-Dumps / fremde Städte / Selfie-Regie raus.
 */

const FOREIGN_CITY_RE =
  /\b(?:Potsdam|München|Munich|Köln|Cologne|Dresden|Leipzig|Stuttgart|Nürnberg|Nuremberg|Amsterdam|Wien|Vienna|Berlin|Prag|Prague)\b/iu;

const SELFIE_META_RE =
  /\b(?:Selfie|Influencer|TikTok|Instagram|Hashtag)\b/iu;

/** Lexikon-/Wikipedia-Dump statt szenischer Tourguide-Speech. */
export function looksLikeLexiconWelcomeDump(speech: string): boolean {
  const t = (speech || '').replace(/\s+/g, ' ').trim();
  if (t.length < 40) return true;
  const head = t.slice(0, 220);
  if (/→/.test(head)) return true;
  if (/;\s*\d{3,4}\b/.test(head)) return true;
  const years = head.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g) || [];
  if (years.length >= 3) return true;
  if (/\b\d{4}\s*[„"]/.test(head) && years.length >= 2) return true;
  return false;
}

/**
 * Fremde Stadt / Selfie-Meta — nicht vorlesen (Stadt-agnostisch, außer eigener Name).
 */
export function isWelcomeSpeechContaminated(
  speech: string,
  cityId: string,
  cityName: string,
): boolean {
  const t = (speech || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (SELFIE_META_RE.test(t)) return true;
  const id = (cityId || '').toLowerCase();
  const name = (cityName || '').toLowerCase();
  const hits = t.match(FOREIGN_CITY_RE) || [];
  for (const raw of hits) {
    const h = raw.toLowerCase();
    if (id.includes(h) || name.includes(h)) continue;
    // Hamburg darf in Pinneberg/Prisdorf als Metropolregion vorkommen — nicht in der Liste.
    return true;
  }
  return false;
}

export function shouldRejectBakedWelcomeSpeech(
  speech: string,
  cityId: string,
  cityName: string,
): boolean {
  return (
    looksLikeLexiconWelcomeDump(speech) ||
    isWelcomeSpeechContaminated(speech, cityId, cityName)
  );
}
