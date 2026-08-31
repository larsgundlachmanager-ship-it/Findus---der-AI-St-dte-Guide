/**
 * Blaupausen-Aliase — Theater≈Kino etc. Kein research_choice-Default.
 */

import {
  getBlueprintContract,
  type BlueprintContract,
} from './registry';
import type { AllowedBlueprintId } from '../router/routeAllowlist';

const ALIAS_MAP: Array<{ re: RegExp; id: AllowedBlueprintId; stage?: string; adapt: string }> = [
  {
    re: /\b(sonnenfinsternis|mondfinsternis|eclipse|sternschnuppe(?:n)?|sternstunde(?:n)?|meteor(?:iten)?(?:schauer)?|perseiden|nordlicht|polarlicht|aurora|vollmond|supermond|komet)\b/iu,
    id: 'sky_phenomenon',
    stage: 'observe',
    adapt:
      'Himmelsphänomen: Wann/wo sichtbar, Wolken wenn belegt, Erinnern anbieten — kein Nightlife.',
  },
  {
    re: /\b(theater|theatre|schauspiel|musical|oper(?:nhaus)?|bühne|buehne)\b/iu,
    id: 'cinema',
    stage: 'cinema_orient',
    adapt:
      'Theater/Musical/Show analog Kino: Venues in der Nähe, Stücke/Genres, Programm-Links — keine Fake-Zeiten.',
  },
  {
    re: /\b(kino|film|cinema|movie)\b/iu,
    id: 'cinema',
    stage: 'cinema_orient',
    adapt: 'Kino: nahe Häuser, Genres, Programm-Deep-Links.',
  },
  {
    re: /\b(hotel|übernacht|uebernacht|hostel|pension|airbnb)\b/iu,
    id: 'hotel',
    stage: 'hotel_choice',
    adapt: 'Hotel: 1–2 Optionen, Partner-/Hotel-URL als Button wenn belegt.',
  },
  {
    re: /\b(essen|restaurant|gastro|pizza|burger|terrasse|draußen|draussen)\b/iu,
    id: 'dining',
    stage: 'dining_choice',
    adapt: 'Dining: Prefs, 2 Optionen wenn Auswahl, Speisekarte nur mit URL.',
  },
  {
    re: /\b(grill|grillen|bbq)\b/iu,
    id: 'compound_evening_goal',
    stage: 'grill',
    adapt: 'Grill/Outdoor-Abendziel: Wetter mitdenken, Orte, Prefs.',
  },
  {
    re: /\b(was geht|events?|party|heute\s+abend|veranstaltung)\b/iu,
    id: 'live_events',
    stage: 'today',
    adapt:
      'Events: echte heutige Programme; Event nennen → erklären (Tourist), Zeiten, Passt-zum-User.',
  },
];

export type BlueprintResolve = {
  contract: BlueprintContract | null;
  blueprintId: AllowedBlueprintId | null;
  adaptBrief: string | null;
  viaAlias: boolean;
};

export function resolveBlueprintForText(opts: {
  userText: string;
  blueprintId?: string | null;
  nearestBlueprint?: string | null;
  stage?: string | null;
}): BlueprintResolve {
  const t = (opts.userText || '').toLowerCase();

  if (opts.blueprintId) {
    const c = getBlueprintContract(opts.blueprintId, opts.stage);
    if (c) {
      return {
        contract: c,
        blueprintId: opts.blueprintId as AllowedBlueprintId,
        adaptBrief: null,
        viaAlias: false,
      };
    }
  }

  if (opts.nearestBlueprint) {
    const c = getBlueprintContract(opts.nearestBlueprint, opts.stage);
    if (c) {
      return {
        contract: c,
        blueprintId: opts.nearestBlueprint as AllowedBlueprintId,
        adaptBrief: `Ähnlich zu ${opts.nearestBlueprint} — Struktur übernehmen, Domäne anpassen.`,
        viaAlias: true,
      };
    }
  }

  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    if (classifyUtteranceFamily(opts.userText || '').family === 'flight') {
      return {
        contract: null,
        blueprintId: null,
        adaptBrief: null,
        viaAlias: false,
      };
    }
  } catch {
    /* soft */
  }

  for (const a of ALIAS_MAP) {
    if (a.re.test(t)) {
      // Celestial + "heute Abend" already guarded
      const c = getBlueprintContract(a.id, a.stage);
      return {
        contract: c,
        blueprintId: a.id,
        adaptBrief: a.adapt,
        viaAlias: a.id === 'cinema' && /theater|theatre|schauspiel|musical|oper/i.test(t),
      };
    }
  }

  // Miss → plain chat, NOT research_choice
  return {
    contract: null,
    blueprintId: null,
    adaptBrief: null,
    viaAlias: false,
  };
}
