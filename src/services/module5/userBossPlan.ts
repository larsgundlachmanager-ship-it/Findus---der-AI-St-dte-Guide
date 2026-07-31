/**
 * User ist Boss: Modul-2-Wünsche sofort, Findus-Vorschläge ohne Rückfrage
 * wieder entfernen wenn User ablehnt / kein Interesse.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import {
  todayDateKey,
  type DayPlanItem,
} from '../../types/dayPlan';
import { resolveStampMapCategory } from '../navigation/stampMapCategories';

export type RejectCategory =
  | 'kirche'
  | 'museum'
  | 'cafe'
  | 'essen'
  | 'natur'
  | 'shopping'
  | 'hotel'
  | 'generic';

const REJECT_PATTERNS: Array<{ cat: RejectCategory; re: RegExp }> = [
  {
    cat: 'kirche',
    re: /\b(?:keine?\s+)?(?:kirchen?|dom|kathedrale|kapelle|münster|muenster)\b/iu,
  },
  {
    cat: 'museum',
    re: /\b(?:keine?\s+)?(?:museen|museum|galerien?|ausstellungen?)\b/iu,
  },
  {
    cat: 'cafe',
    re: /\b(?:keine?\s+)?(?:caf[eé]s?|kaffeehäuser|kaffeehaeuser)\b/iu,
  },
  {
    cat: 'essen',
    re: /\b(?:keine?\s+)?(?:restaurants?|imbisse?|essen\s+gehen)\b/iu,
  },
  {
    cat: 'natur',
    re: /\b(?:keine?\s+)?(?:parks?|natur|aussichtspunkte?|strände|straende)\b/iu,
  },
  {
    cat: 'shopping',
    re: /\b(?:keine?\s+)?(?:läden|laeden|shops?|einkaufen|shopping)\b/iu,
  },
  {
    cat: 'hotel',
    re: /\b(?:keine?\s+)?(?:hotels?|hostels?)\b/iu,
  },
];

const REJECT_INTENT =
  /\b(keine?|nicht|ohne|lass\s+(?:die\s+)?|raus\s+mit|weg\s+mit|streich|lösch|loesch|entferne|brauch\s+ich\s+nicht|will\s+ich\s+nicht|interessiert\s+(?:mich\s+)?nicht|nicht\s+interessiert|mag\s+ich\s+nicht|bloß\s+nicht|bloss\s+nicht)\b/iu;

const CLEAR_SUGGESTIONS =
  /\b(deine\s+vorschl[aä]ge\s+(?:raus|weg|löschen|loeschen)|vorschl[aä]ge\s+(?:raus|weg)|plan\s+(?:aufräumen|aufraeumen)|automatisch(?:e)?\s+(?:wieder\s+)?raus)\b/iu;

function itemMatchesCategory(item: DayPlanItem, cat: RejectCategory): boolean {
  const stamp = resolveStampMapCategory({
    name: item.title,
    category: String(item.meta?.category ?? ''),
    kind: item.kind,
  });
  const blob = `${item.title} ${item.placeName ?? ''} ${item.notes ?? ''}`.toLowerCase();

  switch (cat) {
    case 'kirche':
      return (
        stamp === 'kirche' ||
        /\b(kirche|dom|kathedrale|kapelle|münster|muenster)\b/i.test(blob)
      );
    case 'museum':
      return (
        stamp === 'kultur' ||
        /\b(museum|galerie|ausstellung)\b/i.test(blob)
      );
    case 'cafe':
      return stamp === 'cafe' || /\b(café|cafe|kaffee)\b/i.test(blob);
    case 'essen':
      return stamp === 'essen' || /\b(restaurant|imbiss|pizzeria)\b/i.test(blob);
    case 'natur':
      return stamp === 'natur' || /\b(park|strand|aussicht|düne|duene)\b/i.test(blob);
    case 'shopping':
      return stamp === 'einkaufen' || /\b(laden|shop|markt)\b/i.test(blob);
    case 'hotel':
      return (
        stamp === 'hotel' ||
        item.kind === 'hotel' ||
        /\b(hotel|hostel)\b/i.test(blob)
      );
    default:
      return false;
  }
}

/** Findus-eigene Vorschläge (nicht User-Pflicht). */
export function isFindusOwnedPlanItem(item: DayPlanItem): boolean {
  if (item.meta?.userRequested === true) return false;
  if (item.source === 'user' || item.source === 'voice') return false;
  // Harte User-Deadlines (Zug/Flug die User genannt hat) nicht still löschen
  if (item.hardDeadline && item.source === 'module2' && item.meta?.userRequested !== false) {
    // module2 deadlines from user speech are user intent — keep unless findusSuggestion
    if (item.meta?.findusSuggestion !== true) return false;
  }
  if (item.meta?.findusSuggestion === true) return true;
  if (item.source === 'module5' || item.source === 'module2') return true;
  if (item.source === 'nav' && item.meta?.findusSuggestion === true) return true;
  return false;
}

export function parseRejectedCategories(userText: string): RejectCategory[] {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (!REJECT_INTENT.test(t) && !CLEAR_SUGGESTIONS.test(t)) {
    // Soft: „Kirchen will ich nicht“ ohne starkes Negationswort am Anfang
    if (!/\b(nicht|keine?|ohne|weg|raus)\b/iu.test(t)) return [];
  }
  const cats: RejectCategory[] = [];
  for (const { cat, re } of REJECT_PATTERNS) {
    if (re.test(t) && /\b(nicht|keine?|ohne|weg|raus|streich|lösch|loesch|mag|brauch|interessiert)\b/iu.test(t)) {
      cats.push(cat);
    }
  }
  // „keine Kirchen“ — Pattern trifft „kirchen“, Intent trifft „keine“
  if (!cats.length) {
    for (const { cat, re } of REJECT_PATTERNS) {
      if (re.test(t) && REJECT_INTENT.test(t)) cats.push(cat);
    }
  }
  return [...new Set(cats)];
}

export function wantsClearFindusSuggestions(userText: string): boolean {
  return CLEAR_SUGGESTIONS.test(userText);
}

/**
 * Sofort: User-Ablehnung → Findus-Vorschläge raus, ohne Rückfrage.
 */
export function applyUserPlanOverrides(opts: {
  userText: string;
  dateKey?: string;
}): {
  removed: DayPlanItem[];
  categories: RejectCategory[];
  summary: string | null;
} {
  const dateKey = opts.dateKey ?? todayDateKey();
  const text = opts.userText;
  const cats = parseRejectedCategories(text);
  const clearAll = wantsClearFindusSuggestions(text);
  if (!cats.length && !clearAll) {
    return { removed: [], categories: [], summary: null };
  }

  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const removed: DayPlanItem[] = [];

  for (const item of day.items) {
    if (!isFindusOwnedPlanItem(item)) continue;
    if (item.status === 'done' || item.status === 'in_progress') continue;

    const hit =
      clearAll ||
      cats.some((c) => itemMatchesCategory(item, c));
    if (!hit) continue;

    removed.push(item);
    store.removeItem(dateKey, item.id);
  }

  if (!removed.length) {
    // Merke Dislike trotzdem für künftige Vorschläge
    if (cats.length) {
      useOpenQuestionStore.getState().mergeFromPass1({
        subQuestions: [],
        facts: cats.map((c) => ({
          key: `dislike_${c}`,
          value: 'true',
        })),
        sourceTurn: text.slice(0, 160),
      });
    }
    return {
      removed: [],
      categories: cats,
      summary: cats.length
        ? `Alles klar — keine ${cats.join('/')} mehr vorschlagen.`
        : null,
    };
  }

  useOpenQuestionStore.getState().mergeFromPass1({
    subQuestions: [],
    facts: [
      ...cats.map((c) => ({ key: `dislike_${c}`, value: 'true' })),
      {
        key: 'plan_preference',
        value: `Removed ${removed.length}: ${removed.map((r) => r.title).join(', ')}`,
      },
    ],
    sourceTurn: text.slice(0, 160),
  });

  const labels = removed.map((r) => r.title).slice(0, 4).join(', ');
  const summary = clearAll
    ? `${removed.length} eigene Vorschläge rausgenommen.`
    : `${removed.length}× raus (ohne ${cats.join(', ')}): ${labels}`;

  store.addChange(dateKey, {
    summary,
    reason: 'user_boss_override',
    significant: true,
  });

  return { removed, categories: cats, summary };
}

/** Meta-Flag für Findus-Vorschläge (Tour, „ein paar Orte“…). */
export function markAsFindusSuggestion<T extends DayPlanItem>(item: T): T {
  return {
    ...item,
    meta: {
      ...(item.meta ?? {}),
      findusSuggestion: true,
      userRequested: false,
    },
  };
}

/** Meta-Flag für explizite User-Wünsche. */
export function markAsUserRequested<T extends DayPlanItem>(item: T): T {
  return {
    ...item,
    meta: {
      ...(item.meta ?? {}),
      findusSuggestion: false,
      userRequested: true,
    },
  };
}

export const USER_BOSS_PLAN_POLICY = `USER IST BOSS (Modul 2 → 5):
- User-Wünsche haben IMMER Vorrang und gelten sofort — keine Verzögerung, keine Debatte.
- Alles Planungsrelevante aus Modul 2 landet umgehend in Modul 5 (Tagesplan).
- Findus-eigene Vorschläge (selbst eingetragen) darf Findus ohne Rückfrage wieder löschen, wenn der User sie ablehnt („keine Kirchen“, „interessiert mich nicht“) oder Desinteresse klar ist.
- Nie lange nachfragen zum Entfernen eigener Vorschläge — einfach rausnehmen und kurz bestätigen.
- Explizite User-Termine/Deadlines (User hat sie genannt) nicht still löschen.`;
