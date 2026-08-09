/**
 * Entity-Bind — Speech/User-Text → Orte für Action-Buttons.
 */

import { namesAlign } from '../concierge/canonicalDestination';
import type { ActionEntity } from './types';

const PLACE_RE =
  /\b(?:in|bei|zur|zum|im|auf|Richtung|Route(?:\s+zu)?|Hotel|Restaurant|Café|Cafe|Bar|Museum)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/gu;

const BARE_VENUE_RE =
  /\b((?:Dicke|Große|Kleine|Neue|Alte)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+|(?:Hotel|Restaurant|Café|Cafe|Bar|Museum|Strandbar|Beachbar)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})\b/gu;

const STOP_WORDS =
  /^(Heute|Abend|Uhr|Minuten|Morgen|Stadt|Nähe|Naehe|Hier|Dort|Dir|Dich|Bitte|Apple|Store|Review|Developer|App)$/i;

const NON_PLACE_BLOB =
  /\b(app\s*store|apple\s+developer|testflight|xcode|ios\s+app|einreich|review\s+guidelines?)\b/iu;

function cleanName(s: string): string {
  return s.replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Extrahiert bis zu 2 Favoriten-Orte aus Speech (+ optional User). */
export function extractActionEntities(
  speech: string,
  userText?: string,
  hints?: ActionEntity[],
): ActionEntity[] {
  if (hints?.length) {
    return hints.slice(0, 2).map((h, i) => ({
      ...h,
      name: cleanName(h.name),
      rank: (i === 0 ? 1 : 2) as 1 | 2,
    }));
  }

  const blob = `${speech}\n${userText ?? ''}`.replace(/\s+/g, ' ').trim();
  // Tech-/Wissensfragen → keine Fake-Orte aus „App Store Review“
  if (NON_PLACE_BLOB.test(blob) && !/\b(restaurant|hotel|museum|navigier|route)\b/iu.test(blob)) {
    return [];
  }
  const found: string[] = [];
  const push = (raw: string) => {
    const n = cleanName(raw);
    if (n.length < 3 || STOP_WORDS.test(n)) return;
    if (found.some((f) => namesAlign(f, n) || namesAlign(n, f))) return;
    found.push(n);
  };

  let m: RegExpExecArray | null;
  const re1 = new RegExp(PLACE_RE.source, PLACE_RE.flags);
  while ((m = re1.exec(blob))) push(m[1]);
  const re2 = new RegExp(BARE_VENUE_RE.source, BARE_VENUE_RE.flags);
  while ((m = re2.exec(blob))) push(m[1]);

  return found.slice(0, 2).map((name, i) => ({
    name,
    rank: (i === 0 ? 1 : 2) as 1 | 2,
  }));
}

/** Label/URL müssen zur Entity passen — sonst Drop. */
export function entityMatchesAction(
  entityName: string | undefined,
  label: string,
  destName?: string,
): boolean {
  if (!entityName?.trim()) return true;
  const candidates = [destName, label]
    .filter(Boolean)
    .map((s) =>
      String(s)
        .replace(/^[🥇🥈📍🗺️📜🍹📅🎟️🗣️🛏️📱📶✨🌦️🚇🚕🅿️🧳📞🔗🛒🏨]\s*/u, '')
        .replace(/^(Route|Maps|Webseite|Buchen|Speisekarte):\s*/iu, '')
        .replace(/\s*buchen\*?\s*$/iu, '')
        .replace(/\*+$/u, '')
        .trim(),
    );
  return candidates.some(
    (c) => c.length >= 2 && namesAlign(entityName, c),
  );
}

export function inferCategoryFromBlob(
  blob: string,
): ActionEntity['category'] {
  const t = blob.toLowerCase();
  if (/\b(hotel|pension|hostel|unterkunft|übernacht|uebernacht)\b/.test(t)) {
    return 'hotel';
  }
  if (/\b(bar|club|pub|lounge)\b/.test(t)) return 'bar';
  if (/\b(café|cafe|kaffee|bäckerei|baeckerei)\b/.test(t)) return 'restaurant';
  if (/\b(restaurant|essen|gastro|imbiss|bistro|pizzeria)\b/.test(t)) {
    return 'restaurant';
  }
  if (/\b(museum|galerie|ausstellung)\b/.test(t)) return 'museum';
  if (/\b(theater|konzert|kino|arena)\b/.test(t)) return 'attraction';
  if (/\b(shop|laden|boutique|souvenir)\b/.test(t)) return 'shop';
  return 'other';
}
