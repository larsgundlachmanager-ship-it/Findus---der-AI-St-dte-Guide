/**
 * Letztes Pitch-Publish-Gate: Hard-Musts / Avoid — Soft-Fill nie durchlassen.
 * Pack-Claim ohne Live-Beleg → raus; weiter suchen ist Aufgabe der Stages davor.
 */

import { scoreAyceEvidence } from './hardMatchVerify';
import { looksLikeAyceQuery } from './ayceIntent';
import type { PitchCandidate, PitchOptionCard, PitchRequest } from './types';

function blobOf(c: {
  name?: string;
  softTags?: string[];
  hardEvidence?: string[];
  hookNotes?: string[];
  bullets?: string[];
  whyChosen?: string[];
}): string {
  return [
    c.name,
    ...(c.softTags ?? []),
    ...(c.hardEvidence ?? []),
    ...(c.hookNotes ?? []),
    ...(c.bullets ?? []),
    ...(c.whyChosen ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function avoidAsian(req: PitchRequest): boolean {
  const avoid = (req.prefs.avoidCategories ?? []).join(' ').toLowerCase();
  const text = `${req.title} ${req.context}`.toLowerCase();
  return (
    /asiatisch|asian|kein\s+asia|ohne\s+asia|nicht\s+asiat/.test(avoid) ||
    /kein\s+asiatisch|nicht\s+asiatisch|ohne\s+asia/.test(text)
  );
}

function looksAsian(blob: string): boolean {
  return /asiat|asian|chines|japan|korea|thai|vietnam|sushi|ramen|pho\b|dim\s*sum|mongol|wok\b/.test(
    blob,
  );
}

function wantsAyce(req: PitchRequest): boolean {
  const blob = `${req.title} ${req.context}`;
  if (looksLikeAyceQuery(blob)) return true;
  return (req.wishes ?? []).some(
    (w) =>
      w.hardness === 'must' &&
      /all_you_can_eat|ayce|buffet|schlemmer|must_ayce/i.test(w.text),
  );
}

function wantsOpenAir(req: PitchRequest): boolean {
  return (
    req.multiLane?.hardOutdoorOnly === true ||
    (req.call1MustHaves ?? []).some((m) => /open_air|freiluft/i.test(m)) ||
    /open[\s-]?air|freiluft|sommerkino/i.test(`${req.title} ${req.context}`)
  );
}

function looksOpenAir(blob: string): boolean {
  return /open[\s-]?air|openair|freiluft|outdoor|sommerkino|amphitheatr|freilicht/.test(
    blob,
  );
}

/**
 * Filtert Kandidaten vor Speech/Publish.
 * Leere Liste = Soft-Fail → Mission-Stages/Harvest müssen nachliefern.
 */
export function gatePitchCandidatesForPublish(
  req: PitchRequest,
  candidates: PitchCandidate[],
): { kept: PitchCandidate[]; dropped: number; reason: string | null } {
  let kept = [...candidates];
  let reason: string | null = null;
  const ayce = wantsAyce(req);
  const noAsia = avoidAsian(req);
  const openAir = wantsOpenAir(req);

  if (ayce) {
    const before = kept.length;
    kept = kept.filter((c) => scoreAyceEvidence(blobOf(c)) >= 2);
    if (kept.length < before) reason = 'ayce_hard_gate';
  }
  if (noAsia) {
    const before = kept.length;
    kept = kept.filter((c) => !looksAsian(blobOf(c)));
    if (kept.length < before) reason = reason ?? 'avoid_asian_gate';
  }
  if (openAir) {
    const before = kept.length;
    kept = kept.filter((c) => looksOpenAir(blobOf(c)));
    if (kept.length < before) reason = reason ?? 'open_air_hard_gate';
  }

  // Soft-Fill-Verbot: bei Musts keine leeren Evidence-Treffer behalten
  if (req.forbidSoftFill && (ayce || openAir)) {
    kept = kept.filter((c) => (c.hardEvidence?.length ?? 0) > 0 || scoreAyceEvidence(blobOf(c)) >= 2 || looksOpenAir(blobOf(c)));
  }

  return { kept, dropped: candidates.length - kept.length, reason };
}

export function gatePitchOptionsForPublish(
  req: PitchRequest,
  options: PitchOptionCard[],
): PitchOptionCard[] {
  const ayce = wantsAyce(req);
  const noAsia = avoidAsian(req);
  const openAir = wantsOpenAir(req);
  return options.filter((o) => {
    const b = blobOf(o);
    if (ayce && scoreAyceEvidence(b) < 2 && !/all.?you.?can.?eat|ayce|buffet|schlemmer/i.test(b)) {
      return false;
    }
    if (noAsia && looksAsian(b)) return false;
    if (openAir && !looksOpenAir(b)) return false;
    return true;
  });
}
