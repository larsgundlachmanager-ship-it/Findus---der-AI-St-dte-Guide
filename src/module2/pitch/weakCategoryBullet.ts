/**
 * Stichpunkte: Vibe/Specialty statt nackter Kategorie-Labels („Steak-Restaurant“).
 */

const WEAK_CATEGORY_RE =
  /^(?:steak[-\s]?restaurant|steakhaus|grillhaus|deutsche\s+küche|italienische?\s+küche|asiatische?\s+küche|mediterrane?\s+küche|internationale?\s+küche|restaurant|café|cafe|bar|bistro|imbiss|fast\s*food|fine\s*dining|ambiente|frische\s+gerichte|freundliche\s+bedienung|gemütlich(?:e[sr]?)?|lecker(?:e[sr]?)?|top[-\s]?bewertet(?:es)?(?:\s+steakhaus)?|gute\s+portionen|entspannte?\s+atmosphäre)$/iu;

export function isWeakCategoryBullet(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3) return true;
  if (WEAK_CATEGORY_RE.test(t)) return true;
  // „Cuisine: steak“ / „steak · restaurant“
  if (/^cuisine\s*:/i.test(t)) return true;
  if (/^(steak|pizza|sushi|burger|döner|doener)\s*[·|,/-]\s*(restaurant|küche|haus)\b/iu.test(t)) {
    return true;
  }
  // Reine Vibe-Floskeln ohne Zahl/Gericht
  if (
    /^(ambiente|frische\s+gerichte|freundliche\s+bedienung|gemütlich|lecker|top\s+bewertet)\b/iu.test(
      t,
    ) &&
    !/\d/.test(t) &&
    !/\b(€|euro|km|min|pizza|steak|rucola|ofen)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function filterWeakCategoryBullets(bullets: string[]): string[] {
  return bullets
    .map((b) => String(b || '').trim())
    .filter((b) => b.length >= 3 && !isWeakCategoryBullet(b));
}
