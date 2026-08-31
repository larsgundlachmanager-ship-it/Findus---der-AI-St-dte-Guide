/**
 * Zielgruppen-Fit für Ambient-/Event-Pitches (rein, ohne RN/Gemini).
 */

export type AudienceUserCtx = {
  age: number;
  travelParty?: string | null;
  nightlifeOk?: boolean;
  aboutMe?: string | null;
  softSkipTags?: string[];
};

export type AudienceSpot = {
  name: string;
  kindHint: string;
  hook: string;
  audienceTags?: string[];
  audienceMinAge?: number | null;
  audienceMaxAge?: number | null;
};

const KIDS_TAG_RE =
  /\b(kids?|kinder|familie|family|spielstadt|spielplatz|indoor\s*play|kinderschmink|für\s+kids|ab\s*[3-9]\s*jahren|ü\s*[3-9]|ue\s*[3-9]|grundschul)\b/iu;
const NIGHT_TAG_RE =
  /\b(nightlife|techno|rave|club|disco|underground|afterhour|18\+|21\+|ü\s*18|ue\s*18)\b/iu;
const UE30_TAG_RE =
  /\b(ü\s*30|ue\s*30|ü\s*40|ue\s*40|ü\s*50|best\s*ager|seniors?)\b/iu;

function resolveAgeBandLocal(
  age: number,
): 'child' | 'teen' | 'young' | 'adult' | 'senior' {
  if (!Number.isFinite(age) || age < 1) return 'adult';
  if (age < 12) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'young';
  if (age < 60) return 'adult';
  return 'senior';
}

export function inferAudienceTags(spot: AudienceSpot): string[] {
  const blob = `${spot.name} ${spot.hook} ${spot.kindHint} ${(spot.audienceTags ?? []).join(' ')}`;
  const tags = new Set(
    (spot.audienceTags ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  if (KIDS_TAG_RE.test(blob)) {
    tags.add('kids');
    tags.add('family');
  }
  if (NIGHT_TAG_RE.test(blob)) {
    tags.add('nightlife');
    if (/\btechno|rave|underground\b/iu.test(blob)) tags.add('techno');
  }
  if (UE30_TAG_RE.test(blob)) tags.add('ue30');
  if (/\b(markt|wochenmarkt|flohmarkt)\b/iu.test(blob)) tags.add('market');
  if (/\b(konzert|ausstellung|theater|museum|lesung)\b/iu.test(blob)) {
    tags.add('culture');
  }
  return [...tags];
}

/**
 * Hartfilter: passt das Event zur Person?
 * Oma ≠ Techno, 24 ≠ Ü30-Tür, Erwachsene ohne Kids ≠ Spielstadt.
 */
export function spotFitsUserAudience(
  spot: AudienceSpot,
  user: AudienceUserCtx,
): boolean {
  const age = Number.isFinite(user.age) ? user.age : 30;
  const band = resolveAgeBandLocal(age);
  const tags = inferAudienceTags(spot);
  const skip = new Set(
    (user.softSkipTags ?? []).map((t) => t.trim().toLowerCase()),
  );
  for (const t of tags) {
    if (skip.has(t)) return false;
  }

  const minA =
    spot.audienceMinAge != null && Number.isFinite(spot.audienceMinAge)
      ? spot.audienceMinAge
      : tags.includes('nightlife') || tags.includes('techno')
        ? 18
        : null;
  const maxA =
    spot.audienceMaxAge != null && Number.isFinite(spot.audienceMaxAge)
      ? spot.audienceMaxAge
      : tags.includes('kids') && !tags.includes('family')
        ? 14
        : null;

  if (minA != null && age < minA) return false;
  if (maxA != null && age > maxA) {
    const familyChaperone =
      user.travelParty === 'family' &&
      (tags.includes('kids') || tags.includes('family'));
    if (!familyChaperone) return false;
  }

  if (tags.includes('kids') || tags.includes('spielstadt')) {
    const withKids =
      user.travelParty === 'family' ||
      band === 'child' ||
      /\b(kind|kinder|tochter|sohn|familie)\b/iu.test(user.aboutMe || '');
    if (!withKids && age >= 16) return false;
  }

  if (tags.includes('ue30') && age < 28) return false;

  if (tags.includes('nightlife') || tags.includes('techno')) {
    if (band === 'child' || band === 'teen') return false;
    if (band === 'senior' && !user.nightlifeOk) return false;
    if (user.travelParty === 'family' && !user.nightlifeOk) return false;
    if (age < 18) return false;
  }

  return true;
}
