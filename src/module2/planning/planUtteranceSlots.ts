/**
 * Genannte Plan-Punkte aus dem Rohtext retten — LLM darf nichts weglassen.
 * Struktur, keine Stadt-Hardcodes: jeder genannte Punkt → eigener Timeline-Slot.
 */

import { extractCityFromText } from '../context/shortTermContext';
import {
  arrivalBreakfastHmFromUtterance,
  departureHmFromUtterance,
  destinationCityFromUtterance,
  isBreakfastWish,
  isGenericDayStartWish,
  isTravelToDestWish,
  patchPlanForDestinationCity,
} from './planDestinationCity';
import type { IngestedPlan, IngestGeoAnchor, IngestOpenWish } from './planningTypes';

export type UtteranceSlotKind =
  | 'travel'
  | 'breakfast'
  | 'meal'
  | 'hotel'
  | 'named'
  | 'explore';

export type UtteranceSlot = {
  kind: UtteranceSlotKind;
  title: string;
  context: string;
};

function addMinutesHm(hm: string, addMin: number): string {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hm;
  const total = Number(m[1]) * 60 + Number(m[2]) + addMin;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function foldToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blobCoversTitle(blob: string, title: string): boolean {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (new RegExp(`\\b${escapeRe(t)}\\b`, 'iu').test(blob)) return true;
  const a = foldToken(blob);
  const b = foldToken(t);
  if (b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

const FILLER_RE =
  /^(ich|wir|du|er|sie|es|will|wollte|wolle|möchte|moechte|mal|bitte|den|die|das|dem|der|ein|eine|einen|einem|ganzen|ganze|morgen|heute|abend|uhr|plan|planen|machen|dann|danach|erst|also|bei|ankunft|voraussichtlich|circa|ca|so|gegen|ab|um|in|nach|für|fuer|mit|und|oder|auch|noch|mein|meinen|meinem|los)$/iu;

function stripTimesAndCities(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(
    /\b(?:um|ab|gegen)?\s*\d{1,2}(?::\d{2})?\s*(?:uhr)?\b/giu,
    ' ',
  );
  const city = extractCityFromText(t);
  if (city) {
    t = t.replace(new RegExp(escapeRe(city), 'ig'), ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

function isExploreBoilerplate(clause: string): boolean {
  const t = stripTimesAndCities(clause).toLowerCase();
  if (!t) return true;
  if (
    /\b(tagesplan|stadtrund|highlights?|must[-\s]?see|sightseeing|sehenswürdig)\b/i.test(
      t,
    )
  ) {
    const leftover = t
      .replace(
        /\b(ich|will|den|die|das|ganzen?|plan|planen|machen|tag|in|durch|erkunden|highlights?|must[-\s]?sees?|sightseeing|sehenswürdig(?:keit(?:en)?)?|stadtrund(?:fahrt|gang)?)\b/giu,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    return leftover.length < 4;
  }
  const tokens = t.split(/\s+/).filter((w) => !FILLER_RE.test(w));
  return (
    tokens.length > 0 &&
    tokens.every((w) =>
      /^(plan|tagesplan|erkunden|highlights?|tour|bummel)$/i.test(w),
    )
  );
}

function namedTitleFromClause(clause: string): string | null {
  const t = stripTimesAndCities(clause);
  const tokens = t
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß0-9.-]+$/gu, ''))
    .filter((w) => w.length >= 3 && !FILLER_RE.test(w));
  if (tokens.length === 0) return null;
  if (
    tokens.every((w) =>
      /^(plan|tagesplan|erkunden|highlights?|tour|bummel|stadt)$/i.test(w),
    )
  ) {
    return null;
  }
  const title = tokens.slice(0, 4).join(' ');
  if (title.length < 3) return null;
  return title.slice(0, 48);
}

/** Blick/Sunset sind Kriterien am Abendessen — keine eigenen Timeline-Stops. */
function isViewOrSunsetCriteria(slot: UtteranceSlot): boolean {
  if (slot.kind === 'meal' || slot.kind === 'breakfast' || slot.kind === 'travel') {
    return false;
  }
  // Landmarken nie als Blick-Kriterium (Context kann STT-Nachbartext mit Sunset enthalten).
  if (/\b(michel|museum|kirche|dom|turm|aussichtsturm)\b/i.test(slot.title)) {
    return false;
  }
  if (
    /\b(pann(?:en)?fisch|abendessen|mittagessen|restaurant|frühstück|fruehstueck)\b/i.test(
      slot.title,
    )
  ) {
    return false;
  }
  // Nur Titel — Context oft voller STT-Blob.
  return /\b(elbblick|sonnenuntergang|sunset|elb\s*blick)\b/i.test(slot.title);
}

function viewCriteriaNote(slot: UtteranceSlot): string {
  if (/\b(sonnenuntergang|sunset)\b/i.test(`${slot.title} ${slot.context}`)) {
    return 'Sonnenuntergang';
  }
  if (/\b(elbblick|elb\s*blick)\b/i.test(`${slot.title} ${slot.context}`)) {
    return 'Elbblick';
  }
  return slot.title.replace(/\s+/g, ' ').trim().slice(0, 48);
}

function appendNoteToContext(context: string, note: string): string {
  const n = note.replace(/\s+/g, ' ').trim();
  if (!n) return context;
  if (blobCoversTitle(context, n) || foldToken(context).includes(foldToken(n))) {
    return context;
  }
  const joined = `${context} · ${n}`.replace(/\s+/g, ' ').trim();
  return joined.slice(0, 240);
}

function foldViewCriteriaIntoMeal(
  out: UtteranceSlot[],
  slot: UtteranceSlot,
): boolean {
  if (!isViewOrSunsetCriteria(slot)) return false;
  const meal = out.find((s) => s.kind === 'meal');
  if (!meal) return false;
  meal.context = appendNoteToContext(meal.context, viewCriteriaNote(slot));
  return true;
}

function classifyClause(clause: string): UtteranceSlot | null {
  const t = clause.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return null;
  if (
    /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(t)
  ) {
    return {
      kind: 'breakfast',
      title: /\b(typisch|hamburgerisch|hanseatisch)\b/i.test(t)
        ? 'Typisch hamburgerisch frühstücken'
        : 'Frühstück',
      context: t,
    };
  }
  if (
    /\b(hotel|check[-\s]?in|übernacht|uebernacht|unterkunft)\b/i.test(t)
  ) {
    return { kind: 'hotel', title: 'Hotel', context: t };
  }
  if (
    /\b(abendessen|mittagessen|lunch|dinner|restaurant|italiener|essen(?:\s+gehen)?|pann(?:en)?fisch)\b/i.test(
      t,
    ) ||
    (/\babends\b/i.test(t) &&
      /\b(essen|fisch|blick|sonnenuntergang|sunset|restaurant)\b/i.test(t))
  ) {
    if (!/\b(frühstück|fruehstueck)\b/i.test(t)) {
      const named = namedTitleFromClause(t);
      let title =
        named && !/^(essen|restaurant)$/i.test(named) ? named : 'Essen';
      if (/\bpann(?:en)?fisch\b/i.test(t)) title = 'Pannfisch';
      return { kind: 'meal', title, context: t };
    }
  }
  if (
    /\b(bahn|zug|abfahrt|aufbruch|anreise)\b/i.test(t) ||
    /\blos\b/i.test(t)
  ) {
    if (!/\b(restaurant|museum|essen|frühstück|fruehstueck)\b/i.test(t)) {
      return { kind: 'travel', title: 'Anreise', context: t };
    }
  }
  if (isExploreBoilerplate(t)) {
    return { kind: 'explore', title: 'Erkunden', context: t };
  }
  const named = namedTitleFromClause(t);
  if (!named) return null;
  return { kind: 'named', title: named, context: t };
}

export function extractUtteranceSlots(utterance: string): UtteranceSlot[] {
  const raw = (utterance ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw
    .split(
      /\s*[,:;]\s*|(?:^|\s+)(?:und\s+dann|danach|sowie|außerdem|ausserdem|und\s+noch|abends|und\s+(?:den|die|das|dem))\s+/iu,
    )
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  const out: UtteranceSlot[] = [];
  const seen = new Set<string>();
  const push = (slot: UtteranceSlot) => {
    // Ein Frühstück pro Utterance — Titelvarianten nicht doppelt.
    if (slot.kind === 'breakfast' && out.some((s) => s.kind === 'breakfast')) {
      const existing = out.find((s) => s.kind === 'breakfast')!;
      if (
        /\b(typisch|hamburgerisch|hanseatisch)\b/i.test(slot.title) &&
        !/\b(typisch|hamburgerisch|hanseatisch)\b/i.test(existing.title)
      ) {
        existing.title = slot.title;
      }
      existing.context = appendNoteToContext(existing.context, slot.context.slice(0, 80));
      return;
    }
    if (foldViewCriteriaIntoMeal(out, slot)) return;
    const key = `${slot.kind}:${foldToken(slot.title)}`;
    if (seen.has(key)) return;
    // Identische Titel (auch über kinds) nicht doppelt.
    if (out.some((s) => foldToken(s.title) === foldToken(slot.title))) return;
    seen.add(key);
    out.push(slot);
  };
  for (const part of parts) {
    const slot = classifyClause(part);
    if (slot) push(slot);
  }
  harvestMissingSlots(raw, push, out);
  return out;
}

/** STT klebt oft alles in einen Satz — fehlende Arten nachziehen, nichts doppelt. */
function harvestMissingSlots(
  raw: string,
  push: (slot: UtteranceSlot) => void,
  out: UtteranceSlot[],
): void {
  if (
    !out.some((s) => s.kind === 'travel') &&
    /\b(los|aufbruch|abfahrt)\b/i.test(raw) &&
    extractCityFromText(raw)
  ) {
    push({ kind: 'travel', title: 'Anreise', context: 'Anreise / Los' });
  }
  if (
    !out.some((s) => s.kind === 'breakfast') &&
    /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(raw)
  ) {
    push({
      kind: 'breakfast',
      title: /\b(typisch|hamburgerisch|hanseatisch)\b/i.test(raw)
        ? 'Typisch hamburgerisch frühstücken'
        : 'Frühstück',
      context: /\b(typisch|hamburgerisch|hanseatisch)\b/i.test(raw)
        ? 'Typisch hamburgerisch frühstücken'
        : 'Frühstück',
    });
  }
  if (
    !out.some((s) => s.kind === 'meal') &&
    /\b(pann(?:en)?fisch|abendessen|dinner|restaurant)\b/i.test(raw)
  ) {
    push({
      kind: 'meal',
      title: /\bpann(?:en)?fisch\b/i.test(raw) ? 'Pannfisch' : 'Essen',
      context: raw.slice(0, 180),
    });
  }
  if (/\b(sonnenuntergang|sunset)\b/i.test(raw)) {
    const meal = out.find((s) => s.kind === 'meal');
    if (meal) {
      meal.context = appendNoteToContext(meal.context, 'Sonnenuntergang');
    } else if (!out.some((s) => /sonnenuntergang|sunset/i.test(s.title))) {
      push({
        kind: 'named',
        title: 'Sonnenuntergang',
        context:
          (raw.match(/.{0,40}(?:sonnenuntergang|sunset).{0,60}/i)?.[0] ||
            'Sonnenuntergang').slice(0, 180),
      });
    }
  }
  if (
    /\b(elbblick|elb\s*blick)\b/i.test(raw) &&
    out.some((s) => s.kind === 'meal')
  ) {
    const meal = out.find((s) => s.kind === 'meal')!;
    meal.context = appendNoteToContext(meal.context, 'Elbblick');
  }
  if (
    !out.some((s) => /michel/i.test(s.title)) &&
    /\bmichel\b/i.test(raw)
  ) {
    push({
      kind: 'named',
      title: 'Michel',
      context: 'Michel rauf, Eintritt / Q&A',
    });
  }
  if (
    !out.some((s) => s.kind === 'explore') &&
    /\b(must[-\s]?have|kennenlernen|erkunden|highlights?|sightseeing|zwischendurch)\b/i.test(
      raw,
    )
  ) {
    push({ kind: 'explore', title: 'Erkunden', context: 'Must-Haves / Erkunden' });
  }
}

function planTitlesBlob(plan: IngestedPlan): string {
  return [
    ...plan.openWishesQueue.map((w) => w.title),
    ...plan.fixedNodes.map((n) => n.title),
  ].join(' · ');
}

function planCoversSlot(plan: IngestedPlan, slot: UtteranceSlot): boolean {
  const titles = planTitlesBlob(plan);
  if (slot.kind === 'travel') {
    return plan.openWishesQueue.some(
      (w) => isTravelToDestWish(w) || isGenericDayStartWish(w),
    );
  }
  if (slot.kind === 'breakfast') {
    return plan.openWishesQueue.some((w) => isBreakfastWish(w));
  }
  if (slot.kind === 'meal') {
    return plan.openWishesQueue.some((w) =>
      /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch)\b/i.test(
        w.title,
      ),
    ) || plan.fixedNodes.some((n) =>
      /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch)\b/i.test(
        n.title,
      ),
    );
  }
  if (slot.kind === 'hotel') {
    return /\b(hotel|check[-\s]?in|übernacht|uebernacht|unterkunft)\b/i.test(
      titles,
    );
  }
  if (slot.kind === 'explore') {
    return plan.openWishesQueue.some(
      (w) =>
        w.priority === 6 ||
        /\b(erkunden|highlights?|sightseeing)\b/i.test(w.title),
    );
  }
  // Blick/Sunset: von bestehendem Meal abgedeckt — kein Sibling-Stop.
  if (isViewOrSunsetCriteria(slot)) {
    return plan.openWishesQueue.some((w) =>
      /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch)\b/i.test(
        w.title,
      ),
    );
  }
  return blobCoversTitle(titles, slot.title);
}

function stamp(text: string, dest: string | null | undefined): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!dest || extractCityFromText(trimmed)) return trimmed;
  return trimmed ? `${trimmed} in ${dest}` : dest;
}

function nextFreeHm(wishes: IngestOpenWish[], fallback: string): string {
  let latest = fallback;
  for (const w of wishes) {
    const t = w.estimatedTime;
    if (t && t > latest) latest = t;
  }
  return addMinutesHm(latest, 75);
}

/**
 * Fehlende genannte Punkte als offene Wünsche anhängen — danach Timeline einmal voll.
 */
export function mergeUtteranceSlotsIntoPlan(
  plan: IngestedPlan,
  utterance: string,
): IngestedPlan {
  const dest = plan.destinationCity?.trim() || null;
  const slots = extractUtteranceSlots(utterance);
  if (slots.length === 0) return plan;

  const departHm = departureHmFromUtterance(utterance);
  const breakfastHm = arrivalBreakfastHmFromUtterance(utterance, departHm);
  let wishes = [...plan.openWishesQueue];

  let namedCursor =
    breakfastHm || (departHm ? addMinutesHm(departHm, 90) : '11:00');

  for (const slot of slots) {
    if (planCoversSlot({ ...plan, openWishesQueue: wishes }, slot)) {
      // Blick/Sunset-Kriterien an bestehendes Meal hängen (auch wenn covered).
      if (isViewOrSunsetCriteria(slot)) {
        const mealIdx = wishes.findIndex((w) =>
          /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch)\b/i.test(
            w.title,
          ),
        );
        if (mealIdx >= 0) {
          wishes[mealIdx] = {
            ...wishes[mealIdx]!,
            context: appendNoteToContext(
              wishes[mealIdx]!.context,
              viewCriteriaNote(slot),
            ),
          };
        }
      }
      continue;
    }

    // View/Sunset ohne Cover nur an Meal anhängen — kein neuer Named-Stop.
    if (isViewOrSunsetCriteria(slot)) {
      const mealIdx = wishes.findIndex((w) =>
        /\b(restaurant|essen|dinner|mittag|abendessen|italiener|sushi|pizza|pann(?:en)?fisch)\b/i.test(
          w.title,
        ),
      );
      if (mealIdx >= 0) {
        wishes[mealIdx] = {
          ...wishes[mealIdx]!,
          context: appendNoteToContext(
            wishes[mealIdx]!.context,
            viewCriteriaNote(slot),
          ),
        };
        continue;
      }
    }

    let estimatedTime: string | null = nextFreeHm(wishes, namedCursor);
    let priority: 4 | 5 | 6 = 5;
    let title = stamp(slot.title, dest).slice(0, 48);
    if (slot.kind === 'travel') {
      estimatedTime = departHm || '09:00';
      priority = 4;
      title = stamp(dest ? `Anreise ${dest}` : 'Anreise', dest).slice(0, 48);
    } else if (slot.kind === 'breakfast') {
      // Nur ein Frühstück-Wish — Titelvarianten mergen.
      const existingBf = wishes.findIndex((w) => isBreakfastWish(w));
      if (existingBf >= 0) {
        wishes[existingBf] = {
          ...wishes[existingBf]!,
          context: appendNoteToContext(
            wishes[existingBf]!.context,
            slot.context.slice(0, 80),
          ),
        };
        continue;
      }
      estimatedTime = breakfastHm || addMinutesHm(departHm || '09:00', 60);
      priority = 4;
      title = stamp('Frühstück', dest).slice(0, 48);
    } else if (slot.kind === 'hotel') {
      estimatedTime = '16:00';
      priority = 4;
    } else if (slot.kind === 'meal') {
      const eveningish = /\b(abend|dinner|italiener|sonnenuntergang|sunset|pann(?:en)?fisch|elbblick)\b/i.test(
        slot.context,
      );
      if (eveningish) {
        try {
          const { dinnerHmBeforeSunset } = require('./planWalkOrder') as {
            dinnerHmBeforeSunset: (fb?: string) => string;
          };
          estimatedTime = dinnerHmBeforeSunset('19:30');
        } catch {
          estimatedTime = '19:30';
        }
      } else {
        estimatedTime = /\bmittag/i.test(slot.context)
          ? '12:30'
          : namedCursor;
      }
      priority = 4;
      namedCursor = addMinutesHm(estimatedTime, 75);
    } else if (slot.kind === 'named') {
      const clauseHasClock =
        /\b(?:um|ab|gegen)?\s*\d{1,2}(?::\d{2})?\s*(?:uhr)?\b/i.test(
          slot.context,
        );
      if (/sonnenuntergang|sunset/i.test(slot.title)) {
        // Ohne Meal: Sunset allein erst nach Dinner-Fallback — sonst an Meal (oben).
        try {
          const { dinnerHmBeforeSunset } = require('./planWalkOrder') as {
            dinnerHmBeforeSunset: (fb?: string) => string;
          };
          const dinner = dinnerHmBeforeSunset('19:30');
          estimatedTime = addMinutesHm(dinner, 60);
        } catch {
          estimatedTime = '20:30';
        }
      } else {
        estimatedTime = clauseHasClock ? namedCursor : null;
        if (clauseHasClock) {
          namedCursor = addMinutesHm(namedCursor, 75);
        }
      }
      priority = 5;
    } else if (slot.kind === 'explore') {
      priority = 6;
      title = stamp(dest ? `${dest} erkunden` : 'Erkunden', dest).slice(0, 48);
      estimatedTime = breakfastHm
        ? addMinutesHm(breakfastHm, 75)
        : addMinutesHm(departHm || '09:00', 150);
    }

    // Identische Titel nicht doppelt anlegen.
    if (
      wishes.some(
        (w) =>
          foldToken(w.title) === foldToken(title) ||
          foldToken(w.title) === foldToken(slot.title),
      )
    ) {
      continue;
    }

    wishes.push({
      id: `wish_utt_${slot.kind}_${Date.now()}_${wishes.length}`,
      title,
      priority,
      context: stamp(slot.context.slice(0, 180), dest),
      estimatedTime,
      completeness: 2,
    });
  }

  const dinnerHm = wishes
    .filter((w) =>
      /\b(abendessen|dinner|pann(?:en)?fisch|restaurant|sonnenuntergang)\b/i.test(
        `${w.title} ${w.context}`,
      ),
    )
    .map((w) => w.estimatedTime)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(0);
  const tourStart = breakfastHm
    ? addMinutesHm(breakfastHm, 75)
    : addMinutesHm(departHm || '09:00', 150);
  wishes = wishes.map((w) => {
    const explore =
      w.priority === 6 ||
      /\b(erkunden|highlights?|sightseeing)\b/i.test(w.title);
    if (!explore) return w;
    let t = w.estimatedTime || tourStart;
    if (dinnerHm && t >= dinnerHm) t = tourStart;
    if (dinnerHm && t >= dinnerHm) t = addMinutesHm(dinnerHm, -90);
    return { ...w, estimatedTime: t };
  });

  // Genau ein Frühstück — Titelvarianten zusammenführen.
  const breakfasts = wishes.filter((w) => isBreakfastWish(w));
  if (breakfasts.length > 1) {
    const keep = breakfasts[0]!;
    const mergedCtx = breakfasts
      .slice(1)
      .reduce((c, w) => appendNoteToContext(c, (w.context || '').slice(0, 80)), keep.context);
    wishes = wishes
      .filter((w) => !isBreakfastWish(w) || w === keep)
      .map((w) => (w === keep ? { ...w, context: mergedCtx } : w));
  }

  const travel = wishes.filter((w) => isTravelToDestWish(w));
  const explore = wishes.filter(
    (w) =>
      !isTravelToDestWish(w) &&
      (w.priority === 6 ||
        /\b(erkunden|highlights?|sightseeing)\b/i.test(w.title)),
  );
  const rest = wishes
    .filter((w) => !travel.includes(w) && !explore.includes(w))
    .sort((a, b) =>
      (a.estimatedTime || '99:99').localeCompare(b.estimatedTime || '99:99'),
    );

  return {
    ...plan,
    openWishesQueue: [...travel, ...rest, ...explore],
  };
}

/**
 * Sofort-Skelett in die Timeline, bevor das LLM-Ingest fertig ist.
 */
export function buildSkeletonPlanFromUtterance(opts: {
  utterance: string;
  dayKey: string;
  gpsCity?: string | null;
  destCity?: string | null;
  geoAnchor: IngestGeoAnchor;
}): IngestedPlan {
  const dest =
    opts.destCity?.trim() ||
    destinationCityFromUtterance(opts.utterance, opts.gpsCity) ||
    null;
  const empty: IngestedPlan = {
    targetDate: opts.dayKey,
    geoAnchor: opts.geoAnchor,
    destinationCity: dest,
    fixedNodes: [],
    openWishesQueue: [],
    tasks: [],
    lageMode: 'new',
    bridgeSpeech: '',
    openQuestions: [],
    initialVoiceConfirm: '',
  };
  const merged = mergeUtteranceSlotsIntoPlan(empty, opts.utterance);
  const patched = patchPlanForDestinationCity(
    merged,
    opts.utterance,
    opts.gpsCity ?? null,
  );
  return dest ? { ...patched, destinationCity: dest } : patched;
}
