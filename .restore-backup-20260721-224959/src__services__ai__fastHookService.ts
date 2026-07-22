/**
 * Phase 1 — Fast Hook Generator (< 300ms).
 * Natürliche Sätze ohne Ellipsen-/Regie-Spam.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import {
  resolvePoiUserContext,
  resolvePromptStyleSettings,
} from './PromptBuilderService';
import type { VisitedHistory } from './types';

export type PoiCategory =
  | 'gastro'
  | 'historic'
  | 'church'
  | 'nature'
  | 'station'
  | 'generic';

const GASTRO_RE =
  /(bäck|baeck|café|cafe|kaffee|restaurant|gaststätte|gaststaette|imbiss|bistro|konditorei|rösterei|roesterei)/i;
const HISTORIC_RE =
  /(bahnwärter|bahnwaerter|häuschen|haeuschen|denkmal|schloss|burg|historisch|gebäude|gebaeude|fabrik|mühle|muehle|alter\b|wärter|waerter)/i;
const CHURCH_RE = /(kirche|kapelle|kloster|dom|münster|muenster|synagoge)/i;
const NATURE_RE =
  /(brunnen|park|wald|see|fluss|bach|brücke|bruecke|natur|garten|ufer|wiese)/i;
const STATION_RE = /(bahnhof|haltestelle|bahnsteig|gleis\b)/i;

export function classifyPoiCategory(poi: PoiWithFacts): PoiCategory {
  const hay = `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`;
  if (GASTRO_RE.test(hay)) return 'gastro';
  if (CHURCH_RE.test(hay)) return 'church';
  if (HISTORIC_RE.test(hay)) return 'historic';
  if (STATION_RE.test(hay)) return 'station';
  if (NATURE_RE.test(hay)) return 'nature';
  return 'generic';
}

export function minutesSinceLastPoi(memory?: VisitedHistory): number | null {
  const last = memory?.entries?.[memory.entries.length - 1];
  if (!last?.visitedAt) return null;
  return Math.max(0, (Date.now() - last.visitedAt) / 60_000);
}

export type FastHookInput = {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: VisitedHistory;
};

function hasCoffeeInterest(interestIds: string[], interests: string[]): boolean {
  return (
    interestIds.includes('kaffee') ||
    interestIds.includes('fruehstueck') ||
    interests.some((i) => /kaffee|frühstück|fruehstueck/i.test(i))
  );
}

function pickGreeting(
  firstName: string | null,
  minutesSince: number | null,
): string | null {
  if (minutesSince == null || minutesSince <= 10) return null;
  if (firstName) {
    return `Na, ${firstName}, bereit für die nächste Station?`;
  }
  return 'Na, bereit für die nächste Station?';
}

function interestGastroHook(
  personality: string,
  tone: string,
  hasCoffee: boolean,
): string | null {
  if (!hasCoffee) return null;
  if (personality === 'gen_z') {
    return 'Yo Bro! Na, schon Kaffee-Entzug?';
  }
  if (tone === 'sarkastisch') {
    return 'Endlich Rettung für deinen niedrigen Koffeinspiegel.';
  }
  if (personality === 'dorfaeltester') {
    return 'Na mein Kind, riechst du auch schon den frischen Bohnenkaffee?';
  }
  return 'Riechst du auch schon den frischen Kaffee?';
}

function categoryHook(
  category: PoiCategory,
  poiName: string,
  personality: string,
  tone: string,
  hasCoffee: boolean,
): string {
  if (category === 'gastro') {
    const interestHook = interestGastroHook(personality, tone, hasCoffee);
    if (interestHook) return interestHook;
    if (personality === 'gen_z') {
      return 'Yo, meldet sich schon der kleine Hunger?';
    }
    if (tone === 'sarkastisch') {
      return 'Endlich ein Spot, der deinen Magen ernst nimmt.';
    }
    return 'Na, meldet sich schon der kleine Hunger?';
  }

  switch (category) {
    case 'historic':
      if (personality === 'historiker') {
        return `Ganz schön mächtig, dieses alte Bauwerk, ${poiName}.`;
      }
      if (personality === 'erzaehler') {
        return `Schau mal rüber, da wartet Geschichte in Stein, ${poiName}.`;
      }
      return 'Ganz schön mächtig, dieses alte Gebäude auf der linken Seite, oder?';

    case 'station':
      return `Schau mal rüber zu diesem historischen Häuschen, ${poiName}.`;

    case 'church':
      return 'Mächtige Mauern und eine ganz besondere Stille.';

    case 'nature':
      return 'Zeit für einen kurzen Stopp und Durchatmen an diesem Spot.';

    default:
      if (personality === 'gen_z') {
        return `Yo, ${poiName}. Kurz stehen bleiben lohnt sich.`;
      }
      return `${poiName}, kurz innehalten lohnt sich.`;
  }
}

/**
 * Generiert EINEN sofortigen Hook-Satz (< 300ms, template-basiert).
 */
export function generateFastHook(input: FastHookInput): string {
  const user = resolvePoiUserContext(input.profile);
  const style = resolvePromptStyleSettings(input.profile);
  const category = classifyPoiCategory(input.poi);
  const minutes = minutesSinceLastPoi(input.sessionMemory);
  const hasCoffee = hasCoffeeInterest(user.interestIds, user.interests);

  const greeting = pickGreeting(user.firstName, minutes);
  if (greeting) return greeting;

  return categoryHook(
    category,
    input.poi.name,
    style.personality,
    style.tone,
    category === 'gastro' && hasCoffee,
  );
}
