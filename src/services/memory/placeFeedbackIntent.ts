/**
 * Place feedback: „Der Burgerladen war super lecker“ → lokal merken + Community push.
 */

import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { pushCommunityPlaceFeedback } from './communityPlaceFeedback';
import { contributeErrorAvoidSignal } from './collectiveLearning';

export type PlaceFeedback = {
  placeName: string;
  placeType: 'restaurant' | 'hotel' | 'attraction' | 'custom';
  sentiment: 1 | -1 | 0;
  tipText: string;
  dishMention: string | null;
  /** Silent local save happened */
  savedLocally: boolean;
};

const POS =
  /\b(super|echt|richtig|total|voll|richtig\s+gut|mega|hammer|fantastisch|lecker|köstlich|koestlich|toll|klasse|empfehlenswert|liebe|geliebt|nicht\s+enttäuscht)\b/iu;
const NEG =
  /\b(schrecklich|mies|ekelhaft|enttäuscht|enttaeuscht|nicht\s+gut|furchtbar|grauenvoll|nie\s+wieder|abgeraten)\b/iu;

const PLACE_FEEDBACK_RE =
  /\b(?:der|die|das|dieser|diese|unser|mein)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,4})\s+war\s+(?:echt\s+|richtig\s+|total\s+|voll\s+|super\s+)?(.{0,40}?)$/iu;

const PLACE_FEEDBACK_ALT_RE =
  /\b([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})\s+(?:war|ist)\s+(?:echt\s+|richtig\s+|total\s+|voll\s+|super\s+)?(lecker|gut|toll|klasse|fantastisch|mies|schrecklich|enttäuschen?d)\b/iu;

const DISH_RE =
  /\b((?:chicken\s+)?burger|pizza|pasta|schnitzel|curry|sushi|steak|salat|suppe|bowl|döner|doener|falafel|pommes|fries|risotto|taco|wrap|kuchen|eis)\b/iu;

const PLACE_TYPE_HINT =
  /\b(hotel|pension|hostel|restaurant|café|cafe|imbiss|burger|pizzeria|bäckerei|baeckerei|bar|kneipe)\b/iu;

function cleanPlaceName(raw: string): string | null {
  let s = raw
    .replace(/\s+/g, ' ')
    .replace(/\b(laden|spot|ding|hier)\s*$/iu, '')
    .trim();
  if (s.length < 3 || s.length > 48) return null;
  if (
    /^(heute|gestern|essen|essen gehen|mittag|abend|morgen|super|echt)$/i.test(
      s,
    )
  ) {
    return null;
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function inferType(name: string, text: string): PlaceFeedback['placeType'] {
  const blob = `${name} ${text}`.toLowerCase();
  if (/\b(hotel|pension|hostel)\b/.test(blob)) return 'hotel';
  if (
    /\b(museum|kirche|strand|aussicht|denkmal|park)\b/.test(blob)
  ) {
    return 'attraction';
  }
  if (PLACE_TYPE_HINT.test(blob) || /\b(burger|pizza|essen|lecker)\b/i.test(blob)) {
    return 'restaurant';
  }
  return 'custom';
}

export function detectPlaceFeedback(text: string): PlaceFeedback | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 10) return null;
  if (!POS.test(t) && !NEG.test(t)) return null;

  let placeRaw: string | null = null;
  let tail = t;
  const m1 = t.match(PLACE_FEEDBACK_RE);
  if (m1?.[1]) {
    placeRaw = m1[1];
    tail = m1[2] ?? t;
  }
  if (!placeRaw) {
    const m2 = t.match(PLACE_FEEDBACK_ALT_RE);
    if (m2?.[1]) {
      placeRaw = m2[1];
      tail = m2[2] ?? t;
    }
  }
  if (!placeRaw) return null;

  const placeName = cleanPlaceName(placeRaw);
  if (!placeName) return null;

  const sentiment: 1 | -1 | 0 = NEG.test(t) && !POS.test(t) ? -1 : POS.test(t) ? 1 : 0;
  if (sentiment === 0) return null;

  const dish = t.match(DISH_RE)?.[1] ?? null;
  const tipText =
    sentiment > 0
      ? `${placeName} war positiv (${tail.slice(0, 60).trim() || 'gut'})`
      : `${placeName} war negativ`;

  return {
    placeName,
    placeType: inferType(placeName, t),
    sentiment,
    tipText,
    dishMention: dish ? dish.charAt(0).toUpperCase() + dish.slice(1) : null,
    savedLocally: false,
  };
}

/** Speichert lokal still + pusht Community-Feedback (fire-and-forget). */
export function capturePlaceFeedback(text: string): PlaceFeedback | null {
  const fb = detectPlaceFeedback(text);
  if (!fb) return null;

  const mem = useUserMemoryStore.getState();
  const type =
    fb.placeType === 'hotel'
      ? 'hotel'
      : fb.placeType === 'attraction'
        ? 'attraction'
        : fb.placeType === 'restaurant'
          ? 'restaurant'
          : 'custom';

  // Hotels mit klarem positivem Stay-Feedback: als bestätigt merken
  const confirmHotel =
    type === 'hotel' &&
    fb.sentiment > 0 &&
    /\b(unser|mein)\s+hotel\b/i.test(text);

  const store = useFinnusStore.getState();
  mem.addOrUpdateEntity({
    type,
    name: type === 'hotel' && !/^hotel\b/i.test(fb.placeName)
      ? `Hotel ${fb.placeName}`
      : fb.placeName,
    isConfirmed: confirmHotel || type !== 'hotel',
    lat: store.lastGpsLat ?? undefined,
    lng: store.lastGpsLng ?? undefined,
    notes:
      fb.sentiment > 0
        ? `User-Feedback positiv${fb.dishMention ? ` · Tipp: ${fb.dishMention}` : ''}`
        : 'User-Feedback negativ',
    visitedAt: new Date().toISOString(),
  });

  if (confirmHotel) {
    const hotel = mem.entities
      .filter((e) => e.type === 'hotel')
      .find((e) =>
        e.name.toLowerCase().includes(fb.placeName.toLowerCase()),
      );
    if (hotel) {
      mem.confirmEntity(hotel.id);
      void import('./hotelBasePresence').then((m) =>
        m.applyConfirmedHotelAsDayBase({
          name: hotel.name,
          lat: hotel.lat,
          lng: hotel.lng,
        }),
      );
    }
  }

  const city =
    getCachedUserProfile()?.cityId ??
    getCachedUserProfile()?.cityName ??
    null;

  void pushCommunityPlaceFeedback({
    placeName: fb.placeName,
    placeType: fb.placeType,
    lat: store.lastGpsLat,
    lng: store.lastGpsLng,
    cityHint: city,
    sentiment: fb.sentiment,
    tipText: fb.tipText,
    dishMention: fb.dishMention,
  });

  // Negativ → Crowd-Avoid für alle (Auto ab ≥3 Contributors; Key stabil = Ortsname)
  if (fb.sentiment < 0) {
    const family =
      fb.placeType === 'hotel'
        ? 'accommodation'
        : fb.placeType === 'restaurant'
          ? 'dining'
          : 'sight';
    void contributeErrorAvoidSignal({
      intentFamily: family,
      avoid: [fb.placeName.toLowerCase()],
      summary: `Negativ-Feedback: ${fb.placeName}`.slice(0, 160),
    });
  }

  return { ...fb, savedLocally: true };
}
