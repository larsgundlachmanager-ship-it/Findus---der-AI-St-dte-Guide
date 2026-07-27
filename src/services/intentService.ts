/**
 * Intent-Engine: Hotel-Resolver, History-Recall, Memory-Navigation,
 * Live-Präferenz-Lernen (Vegetarier, Abneigungen, …).
 * Läuft vor Gemini — deterministische Flows für Navigation/Bestätigung.
 */

import { getAllPois, haversineMeters } from '../db/database';
import type { Poi } from '../db/types';
import {
  startNavigation,
  startNavigationToCoords,
} from './navigation';
import {
  useUserMemoryStore,
  type UserEntity,
  type UserEntityType,
} from '../store/useUserMemoryStore';
import { useUserProfileStore } from '../store/useUserProfileStore';
import { parseTagsJson } from './geo/triggerPolicy';
import { isNavAffirmation } from './navigation/pendingOffer';

export type IntentResult = {
  handled: boolean;
  reply?: string;
  startedNav?: boolean;
  /** Profil wurde live aktualisiert */
  profileUpdated?: boolean;
};

const HOTEL_NAV =
  /\b(zum\s+hotel|ins\s+hotel|mein(em)?\s+hotel|zurück\s+zum\s+hotel|zurueck\s+zum\s+hotel|bring\s+mich\s+(zum\s+)?hotel|führ\s+mich\s+(zum\s+)?hotel|fuehr\s+mich\s+(zum\s+)?hotel|navigier(e|en)?\s+(mich\s+)?(zum\s+)?hotel|hotel\s+navig)/iu;

const HOTEL_IAM =
  /\b(ich\s+(bin|wohne|schlafe|übernachte|uebernachte)\s+(im|in|beim|bei)\s+(hotel\s+)?|mein\s+hotel\s+(heißt|heisst|ist)|hotel\s+heißt|hotel\s+heisst)\b/iu;

const HISTORY_NAV =
  /\b(noch\s*mal|nochmal|wieder\s+(zum|zur|zu)|gestern|vorgestern|damals|früher|frueher|zurück\s+zu|zurueck\s+zu|bring\s+mich\s+(noch|wieder)|führ\s+mich\s+(noch|wieder)|fuehr\s+mich\s+(noch|wieder)|burgerladen\s+von|restaurant\s+von)\b/iu;

const DAY_RECALL =
  /\b(wo\s+waren\s+wir|welche\s+orte|was\s+haben\s+wir\s+(gesehen|gemacht)|am\s+(ersten|zweiten|dritten)\s+tag|tour\s*(rückblick|rueckblick|zusammenfassung)|erinnerst\s+du\s+dich)\b/iu;

/** „Wo ist der Bahnhof?“ / „Bring mich zur Kirche“ → echte Navigation. */
const CITY_POI_NAV =
  /\b(wo\s+(ist|liegt|find(?:e|et)\s+ich)|wohin|zeig\s+mir\s+(den\s+weg|wo)|bring\s+mich|führ\s+mich|fuehr\s+mich|navigier|wie\s+komm(?:e|)\s+ich|weg\s+zu(?:m|r)?)\b/iu;

const NEGATION =
  /^(nein|nö|noe|ne|nee|falsch|nicht|kein|andere?s?|doch\s+nicht)\b/iu;

/** Häufige Kurzformen → Match-Tokens gegen POI-Namen. */
const NAV_QUERY_ALIASES: Array<{ keys: RegExp; tokens: string[] }> = [
  { keys: /\bbahnhof\b/i, tokens: ['bahnhof', 'bahnwarte', 'station'] },
  { keys: /\bschwalbe\b/i, tokens: ['schwalbe'] },
  {
    keys: /\b(kindergarten|kita|lütte|luette)\b/i,
    tokens: ['kindergarten', 'kita', 'lütte', 'luette', 'schule'],
  },
  { keys: /\bkirche\b/i, tokens: ['kirche', 'kapelle'] },
  { keys: /\bfeuerwehr\b/i, tokens: ['feuerwehr', 'feuerwache'] },
  { keys: /\bfriseur|coiffeur|salon\b/i, tokens: ['friseur', 'coiffeur', 'salon'] },
];

function extractCityNavQuery(text: string): string | null {
  const patterns = [
    /\bwo\s+(?:ist|liegt)\s+(?:denn\s+)?(?:hier\s+)?(?:der|die|das|dem|den)?\s*(.+?)(?:\?|$)/iu,
    /\bwo\s+find(?:e|et)\s+ich\s+(?:denn\s+)?(?:den|die|das)?\s*(.+?)(?:\?|$)/iu,
    /\b(?:bring|führ|fuehr|navigier(?:e)?)(?:\s+mich)?\s+(?:bitte\s+)?(?:zum|zur|zu\s+dem|zu\s+der|nach)\s+(.+?)(?:\?|$)/iu,
    /\bzeig\s+mir\s+(?:bitte\s+)?(?:den\s+weg\s+)?(?:zum|zur|zu)\s+(.+?)(?:\?|$)/iu,
    /\bwie\s+komm(?:e|)\s+ich\s+(?:denn\s+)?(?:zum|zur|nach)\s+(.+?)(?:\?|$)/iu,
    /\bweg\s+zu(?:m|r)?\s+(.+?)(?:\?|$)/iu,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let q = m[1]
      .replace(/\s+/g, ' ')
      .replace(
        /\s+(bitte|jetzt|mal|denn|hier|in\s+der\s+nähe|in\s+prisdorf).*$/iu,
        '',
      )
      .trim();
    q = q.replace(/^(der|die|das|dem|den|ein|eine)\s+/iu, '').trim();
    if (q.length >= 3) return q.slice(0, 60);
  }
  // „Bahnhof!“ / „Zum Bahnhof“ ohne Fragewort
  if (/\b(zum|zur|nach)\s+([a-zäöüß][\wäöüß\- ]{2,40})$/iu.test(text)) {
    const m = text.match(/\b(?:zum|zur|nach)\s+(.+)$/iu);
    if (m?.[1]) {
      return m[1]
        .replace(/^(der|die|das|dem|den)\s+/iu, '')
        .trim()
        .slice(0, 60);
    }
  }
  return null;
}

function scorePoiForNavQuery(poi: Poi, query: string): number {
  if (poi.kind === 'approach') return -1;
  const name = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const cat = (poi.category ?? '').toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  const q = query.toLowerCase().trim();
  if (q.length < 2) return -1;

  let score = 0;
  if (name.includes(q)) score += 40;
  if (blob.includes(q)) score += 15;

  for (const alias of NAV_QUERY_ALIASES) {
    if (!alias.keys.test(q) && !alias.keys.test(query)) continue;
    for (const tok of alias.tokens) {
      if (blob.includes(tok)) score += 25;
    }
  }

  // Einzel-Tokens aus der Query
  for (const part of q.split(/\s+/)) {
    if (part.length < 4) continue;
    if (name.includes(part)) score += 12;
    else if (blob.includes(part)) score += 6;
  }

  if (poi.kind === 'area' || poi.kind === 'legacy') score += 5;
  if (poi.kind === 'sub') score += 2;
  return score;
}

async function findCityPoiForNavQuery(query: string): Promise<Poi | null> {
  const pois = await getAllPois();
  let best: Poi | null = null;
  let bestScore = 0;
  for (const poi of pois) {
    const s = scorePoiForNavQuery(poi, query);
    if (s > bestScore) {
      bestScore = s;
      best = poi;
    }
  }
  // Mindesttreffer — sonst Gemini antworten lassen
  if (!best || bestScore < 20) return null;
  return best;
}

async function handleCityPoiNavigation(
  text: string,
): Promise<IntentResult | null> {
  if (!CITY_POI_NAV.test(text) && !/\b(zum|zur|nach)\s+\w{3,}/iu.test(text)) {
    return null;
  }
  // History/Hotel-Nav haben eigene Handler — hier nur Stadt-POIs
  if (HISTORY_NAV.test(text) || HOTEL_NAV.test(text)) return null;

  const query = extractCityNavQuery(text);
  if (!query) return null;

  const poi = await findCityPoiForNavQuery(query);
  if (!poi) return null;

  const shortName = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  const ok = await startNavigation(poi.id);
  return {
    handled: true,
    startedNav: ok,
    reply: ok
      ? `Klar — ich führ dich zu ${shortName}. Du musst nicht aufs Display schauen: ich sag dir an sichtbaren Punkten, wo du abbiegen musst.`
      : `Den Ort ${shortName} kenn ich, aber die Navigation startet gerade nicht. Versuch’s gleich nochmal.`,
  };
}

function extractHotelName(text: string): string | null {
  const patterns = [
    /\b(?:hotel|pension|hostel)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
    /\b(?:im|in|beim|bei)\s+(?:hotel\s+)?([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
    /\b(?:heißt|heisst|ist)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].replace(/\s+/g, ' ').trim();
    // Trailing filler words abschneiden
    name = name
      .replace(
        /\s+(kannst|könntest|koenntest|bitte|navigier|bring|führ|fuehr|oder|und).*$/iu,
        '',
      )
      .trim();
    if (name.length < 2) continue;
    if (/^(hotel|pension|hostel)$/i.test(name)) continue;
    if (!/^hotel\b/i.test(name) && !/^pension\b/i.test(name)) {
      name = `Hotel ${name}`;
    }
    return name;
  }
  return null;
}

function extractPlaceQuery(text: string): string | null {
  const m =
    text.match(
      /\b(?:zum|zur|zu\s+dem|zu\s+der|noch\s*mal\s+(?:zum|zur)|wieder\s+(?:zum|zur))\s+(.+?)(?:\s+navig|$|\?)/iu,
    ) ||
    text.match(
      /\b(?:burgerladen|café|cafe|restaurant|pizzeria|bäckerei|baeckerei|imbiss|spot|laden)\b[^.]{0,40}/iu,
    );
  if (!m) return null;
  return (m[1] ?? m[0]).replace(/\s+/g, ' ').trim().slice(0, 60);
}

async function resolvePoiCoords(
  entity: UserEntity,
): Promise<{ lat: number; lng: number; poiId?: number } | null> {
  if (entity.lat != null && entity.lng != null) {
    return { lat: entity.lat, lng: entity.lng, poiId: entity.poiId };
  }
  if (entity.poiId != null) {
    const pois = await getAllPois();
    const poi = pois.find((p) => p.id === entity.poiId);
    if (poi) return { lat: poi.lat, lng: poi.lng, poiId: poi.id };
  }
  const pois = await getAllPois();
  const q = entity.name.toLowerCase().replace(/^hotel\s+/i, '');
  const hit = pois.find((p) => {
    const n = p.name.toLowerCase();
    return n.includes(q) || q.includes(n.replace(/^hotel\s+/i, ''));
  });
  if (hit) return { lat: hit.lat, lng: hit.lng, poiId: hit.id };
  return null;
}

async function navigateToEntity(entity: UserEntity): Promise<boolean> {
  if (entity.poiId != null) {
    const ok = await startNavigation(entity.poiId);
    if (ok) return true;
  }
  const coords = await resolvePoiCoords(entity);
  if (!coords) return false;
  return startNavigationToCoords({
    name: entity.name,
    lat: coords.lat,
    lng: coords.lng,
    poiId: coords.poiId,
  });
}

async function findHotelPoiByName(name: string): Promise<Poi | null> {
  const pois = await getAllPois();
  const q = name.toLowerCase().replace(/^hotel\s+/i, '').trim();
  let best: Poi | null = null;
  for (const poi of pois) {
    const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
    const blob = `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
    const isHotel = /(hotel|pension|unterkunft|hostel)/i.test(blob);
    if (!isHotel && !poi.name.toLowerCase().includes('hotel')) continue;
    const n = poi.name.toLowerCase().replace(/^hotel\s+/i, '');
    if (n.includes(q) || q.includes(n) || blob.includes(q)) {
      best = poi;
      break;
    }
  }
  return best;
}

function formatDaySummary(entities: UserEntity[]): string {
  if (!entities.length) {
    return 'Dazu hab ich noch keine Stops im Gedächtnis — sobald wir irgendwo länger stehen bleiben, merk ich mir das.';
  }
  const parts = entities.slice(0, 8).map((e) => {
    const when = e.visitedAt
      ? e.visitedAt.slice(11, 16)
      : '';
    const dwell =
      e.dwellTimeMinutes != null ? ` (${e.dwellTimeMinutes} Min.)` : '';
    return when ? `${e.name} gegen ${when}${dwell}` : `${e.name}${dwell}`;
  });
  if (parts.length === 1) {
    return `Aus dem Gedächtnis: Wir waren bei ${parts[0]}.`;
  }
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(', ');
  return `Schau mal, das hab ich mir gemerkt: ${head} und ${last}.`;
}

type LearnedPreferenceHit = {
  learnedFact: string;
  reply: string;
  dietaryRestriction?: string;
  dislike?: string;
  toneStyle?: 'ernst' | 'kumpelhaft' | 'sarkastisch' | 'maerchen';
  experiencePref?: { key: string; value: 'yes' | 'no' | 'neutral' };
};

/**
 * Erkennt spontane Präferenz-Aussagen und speichert sie im Profil.
 */
export function detectLearnedPreference(
  text: string,
): LearnedPreferenceHit | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 6) return null;

  if (
    /\b(ich\s+bin\s+(übrigens\s+)?(ein\s+)?vegetarier|bin\s+vegetarier|esse\s+kein\s+fleisch|kein\s+fleisch\s+bitte|nur\s+noch\s+vegetarisch)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Ist Vegetarier',
      dietaryRestriction: 'vegetarisch',
      experiencePref: { key: 'vegetarisch', value: 'yes' },
      reply:
        'Oh, alles klar! Hab ich mir gemerkt — ab jetzt nur noch vegetarische Spots.',
    };
  }

  if (
    /\b(ich\s+bin\s+(übrigens\s+)?(ein\s+)?veganer|bin\s+vegan|esse\s+vegan|nur\s+vegan)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Ist Veganer',
      dietaryRestriction: 'vegan',
      experiencePref: { key: 'vegan', value: 'yes' },
      reply:
        'Super, notiert — ab jetzt halte ich mich an vegane Empfehlungen.',
    };
  }

  if (
    /\b(ich\s+mag\s+(gar\s+)?keinen?\s+fisch|esse\s+keinen?\s+fisch|kein\s+fisch\s+bitte|ohne\s+fisch)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Mag keinen Fisch',
      dietaryRestriction: 'kein Fisch',
      experiencePref: { key: 'fisch', value: 'no' },
      reply:
        'Alles klar — Fisch-Spots lasse ich ab jetzt weg.',
    };
  }

  if (
    /\b(ich\s+mag\s+(gar\s+)?keine\s+kirchen|keine\s+kirchen\s+bitte|kirche[n]?\s+(interessiert|interessieren)\s+mich\s+nicht|skip\s+kirchen)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Mag keine Kirchen',
      dislike: 'keine Kirchen',
      experiencePref: { key: 'kirchen', value: 'no' },
      reply:
        'Verstehe — Kirchen halte ich ab jetzt kurz oder lasse sie aus.',
    };
  }

  if (
    /\b(ich\s+(sitze\s+)?im\s+rollstuhl|bin\s+im\s+rollstuhl|brauche\s+barrierefrei|nur\s+stufenfrei)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Rollstuhl / braucht stufenfreie Wege',
      reply:
        'Alles klar — ich bleibe bei stufenfreien Wegen und zugänglichen Orten.',
    };
  }

  if (
    /\b(ich\s+bin\s+schwanger|wir\s+sind\s+schwanger|kurze\s+wege\s+bitte|keine\s+langen\s+(fuß|fuss)?wege)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Braucht kurze Wege / Pausen',
      dislike: 'keine langen Fußwege',
      reply:
        'Notiert — ich halte die Wege kurz und plane Pausen mit ein.',
    };
  }

  if (
    /\b(keine\s+jahreszahlen|ohne\s+jahreszahlen|jahreszahlen\s+(nerv|langweilig)|weniger\s+geschichte)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Will keine Jahreszahlen',
      dislike: 'keine Jahreszahlen',
      experiencePref: { key: 'jahreszahlen', value: 'no' },
      reply:
        'Alles klar — ich erzähl die Geschichten ohne Zahlenwüste.',
    };
  }

  if (
    /\b(nenn\s+mich\s+nicht\s+(so\s+)?kumpel|nicht\s+(mehr\s+)?kumpel|kein\s+kumpel|ohne\s+kumpel|hör\s+auf.*kumpel|hoer\s+auf.*kumpel|kumpel\s+nennen|nicht\s+kumpelhaft|weniger\s+kumpelhaft|sei\s+nicht\s+so\s+kumpel|nicht\s+so\s+kumpelhaft)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Will nicht „Kumpel" genannt werden — sachlicher Ton',
      dislike: 'Kumpel-Anrede',
      toneStyle: 'ernst',
      reply:
        'Alles klar — ich bleibe sachlicher und nenne dich nicht mehr Kumpel.',
    };
  }

  const merkDir = t.match(
    /\b(?:merk\s+dir|bitte\s+merken|nicht\s+vergessen)[,:]?\s+(.{4,120})$/iu,
  );
  if (merkDir?.[1]) {
    const fact = merkDir[1]
      .replace(/\s*(bitte|danke|ok)\s*$/iu, '')
      .trim();
    if (fact.length >= 4 && fact.length <= 120) {
      return {
        learnedFact: fact.charAt(0).toUpperCase() + fact.slice(1),
        reply: `Hab ich mir gemerkt: ${fact}.`,
      };
    }
  }

  if (
    /\b(ich\s+mag\s+nicht|ich\s+will\s+nicht|bitte\s+nicht)\s+wenn\s+du\b/iu.test(
      t,
    )
  ) {
    const cleaned = t
      .replace(/^.*?\b(wenn\s+du)\s+/iu, '')
      .replace(/\s*(bitte|danke)\s*$/iu, '')
      .trim();
    if (cleaned.length >= 4) {
      const fact =
        cleaned.charAt(0).toUpperCase() + cleaned.slice(1).slice(0, 100);
      return {
        learnedFact: `Mag nicht: ${fact}`,
        reply: `Verstanden — ${fact.charAt(0).toLowerCase() + fact.slice(1)}.`,
      };
    }
  }

  return null;
}

/**
 * Hotel-Bestätigung / Namensnennung / History / Präferenz-Lernen — vor dem LLM.
 */
export async function handleMemoryIntent(
  rawText: string,
): Promise<IntentResult> {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return { handled: false };

  // 0) Live-Präferenzen („Ich bin Vegetarier“ …)
  const learned = detectLearnedPreference(text);
  if (learned) {
    const profileStore = useUserProfileStore.getState();
    const base = profileStore.profile;
    const tonalities = [...(base?.tonalities ?? [])];
    if (learned.toneStyle === 'ernst') {
      const idx = tonalities.indexOf('kumpelhaft');
      if (idx >= 0) tonalities[idx] = 'ernst';
      else if (!tonalities.includes('ernst')) tonalities.push('ernst');
    }

    await profileStore.applyPreferencePatch({
      learnedFact: learned.learnedFact,
      dietaryRestriction: learned.dietaryRestriction,
      dislike: learned.dislike,
      experiencePref: learned.experiencePref,
      toneStyle: learned.toneStyle,
      tonalities: learned.toneStyle ? tonalities : undefined,
    });
    // Rollstuhl / Schwanger auch in accessibility-Array spiegeln
    if (/rollstuhl/i.test(learned.learnedFact)) {
      const p = useUserProfileStore.getState().profile;
      if (p && !p.accessibility.includes('rollstuhl')) {
        await useUserProfileStore.getState().patchProfile({
          accessibility: [...p.accessibility, 'rollstuhl'],
        });
      }
    }
    if (/schwanger|kurze wege/i.test(learned.learnedFact)) {
      const p = useUserProfileStore.getState().profile;
      if (p && !p.accessibility.includes('schwanger') && /schwanger/i.test(text)) {
        await useUserProfileStore.getState().patchProfile({
          accessibility: [...p.accessibility, 'schwanger'],
        });
      }
    }
    return {
      handled: true,
      profileUpdated: true,
      reply: learned.reply,
    };
  }

  const mem = useUserMemoryStore.getState();

  // 1) Warte auf Hotel-Namen nach "Nein"
  if (mem.awaitingHotelName) {
    const named =
      extractHotelName(text) ||
      (/^[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-' ]{1,40}$/u.test(text)
        ? (/^hotel\b/i.test(text) ? text : `Hotel ${text}`)
        : null);
    if (!named) {
      return {
        handled: true,
        reply:
          'Sag mir einfach den Namen — zum Beispiel Hotel Bluezeit. Dann merk ich ihn mir direkt.',
      };
    }
    const poi = await findHotelPoiByName(named);
    const entity = mem.addOrUpdateEntity({
      type: 'hotel',
      name: named,
      isConfirmed: true,
      poiId: poi?.id,
      lat: poi?.lat,
      lng: poi?.lng,
      visitedAt: new Date().toISOString(),
    });
    mem.setAwaitingHotelName(false);
    mem.setPendingHotelConfirm(null);
    const ok = await navigateToEntity(entity);
    return {
      handled: true,
      startedNav: ok,
      reply: ok
        ? `Alles klar, ${entity.name} ist gespeichert — ich führ dich hin.`
        : `Ich merk mir ${entity.name}. Die genaue Position hab ich noch nicht — sobald wir dort sind, fixiere ich sie.`,
    };
  }

  // 2) Ja/Nein auf Hotel-Kandidaten-Frage
  if (mem.pendingHotelConfirmId) {
    const id = mem.pendingHotelConfirmId;
    const candidate = mem.entities.find((e) => e.id === id);
    if (NEGATION.test(text)) {
      mem.setPendingHotelConfirm(null);
      mem.setAwaitingHotelName(true);
      return {
        handled: true,
        reply: 'Alles gut. Wie heißt dein Hotel? Dann merke ich mir das direkt!',
      };
    }
    if (isNavAffirmation(text) || /^(ja|jo|jap|genau|stimmt|richtig)\b/iu.test(text)) {
      if (candidate) {
        mem.confirmEntity(id);
        const ok = await navigateToEntity(candidate);
        return {
          handled: true,
          startedNav: ok,
          reply: ok
            ? `Super — ${candidate.name} ist dein Hotel. Ich führ dich zurück.`
            : `${candidate.name} ist gespeichert. Route krieg ich gerade nicht hin.`,
        };
      }
    }
  }

  // 3) Explizite Hotel-Nennung ("Ich bin im Hotel Bluezeit…")
  const mentionedHotel = extractHotelName(text);
  const isHotelIam = HOTEL_IAM.test(text) || (mentionedHotel && HOTEL_NAV.test(text));
  if (mentionedHotel && (isHotelIam || HOTEL_NAV.test(text) || HOTEL_IAM.test(text))) {
    const poi = await findHotelPoiByName(mentionedHotel);
    const entity = mem.addOrUpdateEntity({
      type: 'hotel',
      name: mentionedHotel,
      isConfirmed: true,
      poiId: poi?.id,
      lat: poi?.lat,
      lng: poi?.lng,
      visitedAt: new Date().toISOString(),
    });
    mem.setPendingHotelConfirm(null);
    mem.setAwaitingHotelName(false);

    const wantsNav =
      HOTEL_NAV.test(text) ||
      /\b(navigier|bring|führ|fuehr|zeig|hin)\b/iu.test(text);
    if (wantsNav) {
      const ok = await navigateToEntity(entity);
      return {
        handled: true,
        startedNav: ok,
        reply: ok
          ? `Alles klar — ${entity.name} ist gespeichert. Ich führ dich hin.`
          : `${entity.name} hab ich mir gemerkt. Die Navigation klappt noch nicht, weil mir die Koordinaten fehlen.`,
      };
    }
    return {
      handled: true,
      reply: `Notiert — ${entity.name} ist jetzt dein Hotel.`,
    };
  }

  // 4) Generisches "Bring mich zum Hotel"
  if (HOTEL_NAV.test(text)) {
    const confirmed = mem.getConfirmedHotel();
    if (confirmed) {
      const ok = await navigateToEntity(confirmed);
      return {
        handled: true,
        startedNav: ok,
        reply: ok
          ? `Alles klar, ich führe dich zurück zum ${confirmed.name}.`
          : `Dein Hotel ${confirmed.name} kenn ich — Route gerade nicht möglich.`,
      };
    }

    const candidate =
      mem.getHotelCandidate() ||
      mem.entities.filter((e) => e.type === 'hotel').slice(-1)[0];
    if (candidate) {
      mem.setPendingHotelConfirm(candidate.id);
      return {
        handled: true,
        reply: `Ich habe das ${candidate.name} in deinem Speicher. Ist das dein Hotel?`,
      };
    }

    mem.setAwaitingHotelName(true);
    return {
      handled: true,
      reply:
        'Welches Hotel meinst du? Sag mir den Namen — dann merke ich ihn mir und führ dich hin.',
    };
  }

  // 5) Tages-Rückblick
  if (DAY_RECALL.test(text)) {
    let sinceIso: string | undefined;
    if (/ersten\s+tag|erster\s+tag/i.test(text)) {
      // grob: letzte 36h rückwärts vom ältesten Cluster — einfach alle Entities
      const all = mem.findEntities({});
      if (all.length) {
        const oldest = [...all]
          .filter((e) => e.visitedAt)
          .sort(
            (a, b) =>
              Date.parse(a.visitedAt!) - Date.parse(b.visitedAt!),
          )[0];
        if (oldest?.visitedAt) {
          const dayStart = new Date(oldest.visitedAt);
          dayStart.setHours(0, 0, 0, 0);
          sinceIso = dayStart.toISOString();
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayEntities = all.filter((e) => {
            if (!e.visitedAt) return false;
            const t = Date.parse(e.visitedAt);
            return t >= dayStart.getTime() && t < dayEnd.getTime();
          });
          return {
            handled: true,
            reply: formatDaySummary(dayEntities),
          };
        }
      }
    }
    if (/gestern/i.test(text)) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      sinceIso = d.toISOString();
    }
    const list = mem.findEntities({ sinceIso });
    return { handled: true, reply: formatDaySummary(list) };
  }

  // 6) Zurück zu Restaurant / Spot von gestern
  if (HISTORY_NAV.test(text)) {
    const q = extractPlaceQuery(text);
    const typeHint: UserEntityType | undefined = /burger|restaurant|café|cafe|pizzeria|imbiss|essen/i.test(
      text,
    )
      ? 'restaurant'
      : undefined;

    let matches = mem.findEntities({
      type: typeHint,
      nameQuery: q ?? undefined,
      sinceIso: /gestern/i.test(text)
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            d.setHours(0, 0, 0, 0);
            return d.toISOString();
          })()
        : undefined,
    });

    if (!matches.length && (q || typeHint)) {
      matches = mem.findEntities({
        type: typeHint,
        nameQuery: q ?? (typeHint === 'restaurant' ? 'burger' : undefined),
      });
    }

    // Fallback: recent restaurants
    if (!matches.length && /burger|restaurant|café|cafe|essen/i.test(text)) {
      matches = mem.findEntities({ type: 'restaurant' });
    }

    const target = matches[0];
    if (!target) return { handled: false };

    const ok = await navigateToEntity(target);
    return {
      handled: true,
      startedNav: ok,
      reply: ok
        ? `Klar — ich bring dich nochmal zum ${target.name}.`
        : `${target.name} kenn ich aus dem Gedächtnis, aber die Koordinaten fehlen mir noch.`,
    };
  }

  // 7) Stadt-POI: „Wo ist der Bahnhof?“ → Navigation starten
  const cityNav = await handleCityPoiNavigation(text);
  if (cityNav) return cityNav;

  return { handled: false };
}

/** Debug / Tests */
export function __testExtractHotelName(text: string): string | null {
  return extractHotelName(text);
}

export function distanceToEntityMeters(
  lat: number,
  lng: number,
  entity: UserEntity,
): number | null {
  if (entity.lat == null || entity.lng == null) return null;
  return haversineMeters(lat, lng, entity.lat, entity.lng);
}
