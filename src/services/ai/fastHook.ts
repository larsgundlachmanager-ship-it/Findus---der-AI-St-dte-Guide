/**
 * Fast-Hook: spontaner Einleitungssatz (< 200ms) bei POI-Trigger.
 * Sofort an Kokoro — parallel zur Story-Generierung.
 * Keine künstlichen Regie-Texte; natürliche Interpunktion.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile, VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  lastVisitedPlace,
  type SessionMemory,
} from './sessionMemory';

export type PoiHookKind =
  | 'cafe'
  | 'church'
  | 'museum'
  | 'castle'
  | 'park'
  | 'bar'
  | 'market'
  | 'historic'
  | 'generic';

const KIND_LABEL_DE: Record<PoiHookKind, string> = {
  cafe: 'Café',
  church: 'Kirche',
  museum: 'Museum',
  castle: 'Schloss',
  park: 'Park',
  bar: 'Bar',
  market: 'Markt',
  historic: 'Gebäude',
  generic: 'Ort',
};

type HookBank = Record<PoiHookKind, string[]>;

const BASE_HOOKS: HookBank = {
  cafe: [
    'Riechst du auch schon den frischen Kaffee?',
    'Na, meldet sich schon der kleine Hunger?',
  ],
  church: [
    'Schau dir diese mächtigen alten Mauern an.',
    'Mächtige Mauern und eine ganz besondere Stille.',
  ],
  museum: ['Hier steckt echte Geschichte drin.'],
  castle: ['Ganz schön mächtig, dieses alte Bauwerk, oder?'],
  park: ['Zeit für einen kurzen Stopp und Durchatmen an diesem Spot.'],
  bar: ['Hier geht abends was, merken wir uns den Spot.'],
  market: ['Markt-Vibes. Mal schauen, was hier los ist.'],
  historic: [
    'Schau mal rüber zu diesem historischen Häuschen.',
    'Ganz schön mächtig, dieses alte Gebäude auf der linken Seite, oder?',
  ],
  generic: [
    'Pass auf, hier steckt eine Geschichte drin.',
    'Schau dich um. Dieser Spot hat was zu erzählen.',
    'Glaubst du an Zufälle? Genau hier passierte etwas, das die Gegend verändert hat.',
  ],
};

const VOICE_HOOKS: Partial<Record<VoiceId, Partial<HookBank>>> = {
  gen_z: {
    cafe: ['Yo, schon Kaffee-Entzug?', 'Kaffee-Spot detected, der Vibe stimmt.'],
    church: ['Alte Mauern, big energy. Schau dir das an.'],
    generic: ['Yo, neuer Spot. Kurz reinzoomen.'],
  },
  prinzessin: {
    cafe: ['Ein Ort des warmen Tranks. Tritt näher, werter Gast.'],
    church: ['Heilige Steine, alte Gebete. Hörst du das Echo der Jahrhunderte?'],
    generic: ['Tritt näher. Dieser Ort flüstert von Zauber und Zeit.'],
  },
  erzaehler: {
    cafe: ['Nahaufnahme: dampfender Kaffee. Die Szene beginnt.'],
    church: ['Und dann diese Mauern, als wäre hier ein Blockbuster gedreht worden.'],
    historic: ['Kulisse wie aus einem Epos. Vorhang auf.'],
    generic: ['Die nächste Szene beginnt jetzt.'],
  },
  dorfaeltester: {
    cafe: ['Na mein Kind, riechst du auch schon den frischen Bohnenkaffee?'],
    church: ['Diese Kirche kenn ich, seit ich denken kann.'],
    generic: ['Na mein Kind, hier war ich schon, bevor du geboren warst.'],
  },
  historiker: {
    church: ['Schau dir diese Mauern an: Sakralbau mit klarer historischer Schicht.'],
    historic: ['Dieses Bauwerk verdient eine kurze historische Einordnung.'],
  },
  energisch: {
    cafe: ['Hey, Kaffee-Power? Hier könnte der Boost warten!'],
    church: ['Wow, diese Mauern! Bereit für ein Geschichts-Abenteuer?'],
    generic: ['Hey, neuer Ort, Abenteuer-Modus an!'],
  },
};

export function classifyPoiHookKind(poi: PoiWithFacts): PoiHookKind {
  const blob = `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`.toLowerCase();
  if (/(café|cafe|kaffee|bäck|baeck|rösterei|coffee|konditorei)/i.test(blob))
    return 'cafe';
  if (/(kirche|dom|kapelle|cathedral|kloster|münster|muenster)/i.test(blob))
    return 'church';
  if (/(museum|galerie|ausstellung)/i.test(blob)) return 'museum';
  if (/(schloss|burg|castle|festung)/i.test(blob)) return 'castle';
  if (/(park|garten|garden|grünanlage|brunnen)/i.test(blob)) return 'park';
  if (/(bar|club|kneipe|pub|disco)/i.test(blob)) return 'bar';
  if (/(markt|market|wochenmarkt)/i.test(blob)) return 'market';
  if (
    /(bahnwärter|bahnwaerter|häuschen|haeuschen|denkmal|historisch|fabrik|mühle|muehle|rathaus)/i.test(
      blob,
    )
  ) {
    return 'historic';
  }
  return 'generic';
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}

function bridgeHook(
  kind: PoiHookKind,
  last: { kind: PoiHookKind; name: string } | null,
): string | null {
  if (!last || last.kind !== kind) return null;
  const label = KIND_LABEL_DE[kind];
  switch (kind) {
    case 'church':
      return 'Und schon stehen wir vor der nächsten Kirche.';
    case 'cafe':
      return 'Und wieder ein Kaffee-Spot, direkt nach dem letzten.';
    case 'museum':
      return 'Schon das nächste Museum, nach dem vorhin.';
    case 'historic':
    case 'castle':
      return `Und schon das nächste ${label}, direkt nach ${last.name}.`;
    default:
      return `Und schon stehen wir am nächsten ${label}.`;
  }
}

/**
 * Sofort spielbarer Hook (Satz 1) für POI-Ankunft.
 */
export function buildFastHook(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  sessionMemory?: SessionMemory | null,
): string {
  const p = profile ?? getCachedUserProfile();
  const voiceId = (p?.voiceId ?? 'standard_m') as VoiceId;
  const kind = classifyPoiHookKind(poi);
  const last = lastVisitedPlace(sessionMemory);

  const bridge = bridgeHook(
    kind,
    last ? { kind: last.kind, name: last.name } : null,
  );
  if (bridge) return bridge;

  const voiceBank = VOICE_HOOKS[voiceId];
  const candidates =
    voiceBank?.[kind] ??
    voiceBank?.generic ??
    BASE_HOOKS[kind] ??
    BASE_HOOKS.generic;

  return pick(candidates);
}
