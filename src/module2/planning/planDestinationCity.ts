/**
 * Zielstadt vs GPS-Pack — stadt-agnostisch.
 * GPS/aktives Pack ist oft nur der Start; der Plan kann in einer anderen Stadt liegen.
 */

import { extractCityFromText } from '../context/shortTermContext';
import { foldCityKey } from '../../services/navigation/landmarkAliases';
import type { IngestedPlan, IngestOpenWish } from './planningTypes';

export function sameFoldedCity(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const fa = foldCityKey(a);
  const fb = foldCityKey(b);
  if (!fa || !fb || fa.length < 3 || fb.length < 3) return false;
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}

export function destinationCityFromUtterance(
  utterance: string,
  gpsCity?: string | null,
): string | null {
  const named = extractCityFromText(utterance);
  if (!named) return null;
  if (gpsCity && sameFoldedCity(named, gpsCity)) return null;
  return named;
}

export function isGenericDayStartWish(wish: {
  title: string;
  context: string;
}): boolean {
  const t = `${wish.title} ${wish.context}`.replace(/\s+/g, ' ').trim();
  if (isBreakfastWish(wish)) return false;
  return (
    /\baktivit[aä]t\b/i.test(t) ||
    /\bstart\s+(in\s+den\s+tag|gegen|um)\b/i.test(t) ||
    /\bstart\s+gegen\b/i.test(t) ||
    /\blos\s+(um|gehen|fahren|mit)\b/i.test(t) ||
    /\baufbruch\b/i.test(t) ||
    /\b(abfahrt|bahn|zug)\b/i.test(t) ||
    /^start\b/i.test(wish.title.trim())
  );
}

export function isBreakfastWish(wish: {
  title: string;
  context: string;
}): boolean {
  return /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(
    `${wish.title} ${wish.context}`,
  );
}

export function isTravelToDestWish(wish: {
  title: string;
  context: string;
}): boolean {
  const t = `${wish.title} ${wish.context}`.toLowerCase();
  if (isBreakfastWish(wish)) return false;
  return (
    /\b(anreise|aufbruch|hinfahrt|fahrt\s+nach|los\s+nach|anfahrt|bahn\s+nach|zug\s+nach|abfahrt)\b/i.test(
      t,
    )
  );
}

export function userWantsDestinationDay(utterance: string): boolean {
  const t = utterance.replace(/\s+/g, ' ').trim();
  if (!t || !extractCityFromText(t)) return false;
  if (
    /\b(erkunden|sightseeing|must[-\s]?see|highlights?|sehenswürdig|sehenswuerdigkeit|tagesplan|tag\s+(in|durch)|plan(?:e|en|ung)?\s+f(?:ü|ue)r|stadtrund|bummel|tour)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(und\s+dann|danach|zuerst|außerdem|ausserdem)\b/i.test(t) &&
    t.length >= 60
  ) {
    return true;
  }
  // Compound-Tag ohne „Plan“-Wort: Los + Frühstück + Abendort.
  if (
    /\b(los|aufbruch|abfahrt)\b/i.test(t) &&
    /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(t) &&
    t.length >= 50
  ) {
    return true;
  }
  // Zukunfts-Wochentag + andere Stadt + Los = Tagesplan, nicht Live-Nav.
  if (
    /\b(morgen|übermorgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(
      t,
    ) &&
    /\b(los|aufbruch|abfahrt)\b/i.test(t) &&
    t.length >= 40
  ) {
    return true;
  }
  // Gesprochen: „Morgen nach Hamburg, frühstücken, Pannfisch, Michel“ —
  // ohne Plan-Verb, ohne „los“. EIN einzelner Essenswunsch ≠ Tagesplan (→ Pitch).
  if (
    extractCityFromText(t) &&
    /\b(morgen|übermorgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(
      t,
    ) &&
    t.length >= 45 &&
    /\b(frühstück|fruehstueck|breakfast|essen|pann|michel|tour|erkunden|abend)/i.test(
      t,
    )
  ) {
    const activityHits = [
      /\bfrühstück/i,
      /\bfruehstueck/i,
      /\bbreakfast\b/i,
      /\bessen\b/i,
      /\bpann/i,
      /\bmichel\b/i,
      /\btour\b/i,
      /\berkunden\b/i,
      /\babend(?:essen)?\b/i,
      /\brestaurant\b/i,
      /\bmuseum\b/i,
      /\bspazier/i,
    ].filter((re) => re.test(t)).length;
    const multiWish =
      activityHits >= 2 ||
      /\b(und\s+dann|danach|zuerst|außerdem|ausserdem)\b/i.test(t) ||
      /\b(tagesplan|planen|organisiere|ganzer\s+tag|durchplanen)\b/i.test(t);
    if (!multiWish) return false;
    return true;
  }
  return false;
}

function stampCity(blob: string, city: string): string {
  if (extractCityFromText(blob)) return blob;
  const trimmed = blob.replace(/\s+/g, ' ').trim();
  return trimmed ? `${trimmed} in ${city}` : `in ${city}`;
}

function addMinutesHm(hm: string, addMin: number): string {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hm;
  const total = Number(m[1]) * 60 + Number(m[2]) + addMin;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

type ClockHit = { hm: string; idx: number; around: string };

function clockHitsInText(text: string): ClockHit[] {
  const t = (text ?? '').replace(/\s+/g, ' ');
  const hits: ClockHit[] = [];
  const re =
    /\b(?:(?:um|ab|gegen)\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const raw = `${m[1]}${m[2] != null ? `:${m[2]}` : ''}`;
    const h = Number(m[1]);
    if (!Number.isFinite(h) || h > 23) continue;
    const hasUhr = /uhr/i.test(m[0]);
    const hasPrefix = /^(um|ab|gegen)\b/i.test(m[0].trim());
    const hasColon = m[2] != null;
    if (!hasUhr && !hasPrefix && !hasColon) continue;
    const hm = `${String(h).padStart(2, '0')}:${(m[2] ?? '00').padStart(2, '0')}`;
    const idx = m.index ?? 0;
    hits.push({
      hm,
      idx,
      around: t.slice(Math.max(0, idx - 36), idx + m[0].length + 36).toLowerCase(),
    });
  }
  return hits;
}

const DEPART_AROUND =
  /\b(bahn|zug|s-?\s*bahn|abfahrt|abfahren|los|aufbruch|hinfahrt|anreise)\b/i;
const ARRIVE_AROUND =
  /\b(ankunft|ankommen|frühstück|fruehstueck|dort|voraussichtlich)\b/i;

/** Bahn/Los-Uhrzeit aus dem Rohtext. */
export function departureHmFromUtterance(utterance: string): string | null {
  const hits = clockHitsInText(utterance);
  const dep = hits.find((h) => DEPART_AROUND.test(h.around));
  return dep?.hm ?? null;
}

/**
 * Frühstück/Ankunft — nicht die Abfahrt.
 * Nennt der User keine Zeit: ~60 Min nach Abfahrt.
 */
export function arrivalBreakfastHmFromUtterance(
  utterance: string,
  departHm?: string | null,
): string | null {
  const t = (utterance ?? '').replace(/\s+/g, ' ');
  const wantsMeal = /\b(frühstück|fruehstueck|breakfast)\b/i.test(t);
  const wantsArrive = /\b(ankunft|ankommen|bei ankunft|nach ankunft)\b/i.test(t);
  if (!wantsMeal && !wantsArrive) return null;
  const hits = clockHitsInText(t);
  const meal = hits.find(
    (h) => ARRIVE_AROUND.test(h.around) && h.hm !== departHm,
  );
  if (meal) return meal.hm;
  if (departHm) return addMinutesHm(departHm, 60);
  return '10:00';
}

function travelTitle(utterance: string, dest: string): string {
  if (/\b(bahn|zug|s-?\s*bahn)\b/i.test(utterance)) {
    return `Bahn nach ${dest}`.slice(0, 48);
  }
  return `Anreise ${dest}`.slice(0, 48);
}

/**
 * Nach LLM-Ingest: Zielstadt aus dem Rohtext retten, GPS-Kollaps verhindern.
 * geoAnchor bleibt der Start (GPS) — Recherche läuft in destinationCity.
 * „Los um 9 / Bahn ab 9“ = Abfahrt; Frühstück erst bei Ankunft.
 */
export function patchPlanForDestinationCity(
  plan: IngestedPlan,
  utterance: string,
  gpsCity?: string | null,
): IngestedPlan {
  const dest =
    destinationCityFromUtterance(utterance, gpsCity) ||
    extractCityFromText(
      [
        ...plan.openWishesQueue.map((w) => `${w.title} ${w.context}`),
        ...plan.fixedNodes.map((n) => `${n.title} ${n.location ?? ''}`),
      ].join(' '),
    ) ||
    (plan.destinationCity &&
    (!gpsCity || !sameFoldedCity(plan.destinationCity, gpsCity))
      ? plan.destinationCity
      : null);
  const destForeign = Boolean(
    dest && gpsCity && !sameFoldedCity(dest, gpsCity),
  );
  const destOnly = Boolean(dest && !gpsCity);
  if (!dest || (!destForeign && !destOnly)) {
    return { ...plan, destinationCity: plan.destinationCity ?? null };
  }

  const departHm =
    departureHmFromUtterance(utterance) ||
    plan.openWishesQueue.find((w) => isGenericDayStartWish(w))?.estimatedTime ||
    plan.openWishesQueue.find((w) => isTravelToDestWish(w))?.estimatedTime ||
    (/\b(los|bahn|zug|aufbruch|abfahrt)\b/i.test(utterance) ? '09:00' : null);
  const breakfastHm = arrivalBreakfastHmFromUtterance(utterance, departHm);
  const wantsBreakfast = /\b(frühstück|fruehstueck|breakfast)\b/i.test(
    utterance,
  );

  const toTravelWish = (w: IngestOpenWish): IngestOpenWish => ({
    ...w,
    title: travelTitle(utterance, dest),
    context: stampCity(
      `Los${departHm ? ` um ${departHm}` : ''} mit Bahn/Zug vom aktuellen Standort nach ${dest}`,
      dest,
    ),
    estimatedTime: departHm || w.estimatedTime || '09:00',
    priority: 4,
    completeness: 2,
  });

  const toBreakfastWish = (w: IngestOpenWish): IngestOpenWish => ({
    ...w,
    title: stampCity('Frühstück', dest).slice(0, 48),
    context: stampCity(
      `Frühstück nach Ankunft in ${dest}${breakfastHm ? ` ab ${breakfastHm}` : ''}`,
      dest,
    ),
    estimatedTime: breakfastHm || w.estimatedTime || '10:00',
    priority: 4,
    completeness: 2,
  });

  const atDepart = (hm: string | null | undefined) =>
    Boolean(departHm && hm && hm === departHm);

  let wishes = plan.openWishesQueue.map((w) => {
    if (isBreakfastWish(w)) {
      if (atDepart(w.estimatedTime) || !w.estimatedTime) {
        return toBreakfastWish(w);
      }
      return {
        ...w,
        title: stampCity(w.title, dest).slice(0, 48),
        context: stampCity(w.context || w.title, dest),
      };
    }
    if (
      isGenericDayStartWish(w) ||
      isTravelToDestWish(w) ||
      (atDepart(w.estimatedTime) &&
        /\b(start|los|aktivität|aktivitaet|bahn|zug|abfahrt)\b/i.test(
          `${w.title} ${w.context}`,
        ))
    ) {
      return toTravelWish(w);
    }
    return {
      ...w,
      title: stampCity(w.title, dest).slice(0, 48),
      context: stampCity(w.context || w.title, dest),
    };
  });

  if (!wishes.some((w) => isTravelToDestWish(w)) && departHm) {
    wishes = [
      {
        id: `wish_dest_travel_${Date.now()}`,
        title: travelTitle(utterance, dest),
        priority: 4,
        context: stampCity(
          `Los um ${departHm} vom aktuellen Standort nach ${dest}`,
          dest,
        ),
        estimatedTime: departHm,
        completeness: 2,
      },
      ...wishes,
    ];
  }

  if (wantsBreakfast && !wishes.some((w) => isBreakfastWish(w))) {
    wishes = [
      ...wishes,
      {
        id: `wish_dest_breakfast_${Date.now()}`,
        title: stampCity('Frühstück', dest).slice(0, 48),
        priority: 4,
        context: stampCity(
          `Frühstück nach Ankunft in ${dest}${breakfastHm ? ` ab ${breakfastHm}` : ''}`,
          dest,
        ),
        estimatedTime: breakfastHm || '10:00',
        completeness: 2,
      },
    ];
  }

  const hasExplore = wishes.some(
    (w) =>
      w.priority === 6 ||
      /\b(erkunden|highlights?|sightseeing|must[-\s]?see)\b/i.test(
        `${w.title} ${w.context}`,
      ),
  );
  if (userWantsDestinationDay(utterance) && !hasExplore) {
    const exploreStart =
      breakfastHm ||
      (departHm ? addMinutesHm(departHm, 90) : null) ||
      '11:00';
    wishes = [
      ...wishes,
      {
        id: `wish_dest_explore_${Date.now()}`,
        title: `${dest} erkunden`.slice(0, 48),
        priority: 6,
        context: stampCity(`Tagesplan / Highlights in ${dest}`, dest),
        estimatedTime: exploreStart,
        completeness: 2,
      },
    ];
  }

  const extraFromFixed: IngestOpenWish[] = [];
  const fixedNodes = plan.fixedNodes.filter((n) => {
    const blob = `${n.title} ${n.location ?? ''}`;
    if (isGenericDayStartWish({ title: n.title, context: blob })) return false;
    if (isBreakfastWish({ title: n.title, context: blob }) && atDepart(n.time)) {
      extraFromFixed.push(
        toBreakfastWish({
          id: `wish_fixed_breakfast_${Date.now()}`,
          title: n.title,
          priority: 4,
          context: blob,
          estimatedTime: n.time,
          completeness: 2,
        }),
      );
      return false;
    }
    return true;
  });
  if (extraFromFixed.length) {
    wishes = [...wishes, ...extraFromFixed];
  }

  return {
    ...plan,
    destinationCity: dest,
    fixedNodes,
    openWishesQueue: wishes,
  };
}

export function keepExploreWishForDestination(
  utterance: string,
  gpsCity?: string | null,
): boolean {
  if (userWantsDestinationDay(utterance)) return true;
  return Boolean(destinationCityFromUtterance(utterance, gpsCity));
}
