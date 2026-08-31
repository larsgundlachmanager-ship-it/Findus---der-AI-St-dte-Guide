/**
 * Lübeck / Sport-Trip Szenario-Battery — Blaupausen-Erwartungen, kein Script.
 * Expandiert Templates zu ~400 User-Fragen für Gate/Device-Playbook.
 */

export type ScenarioExpect = {
  /** Job-/Domain-Familie (heuristisch) */
  family:
    | 'dining'
    | 'hotel'
    | 'tour'
    | 'sight'
    | 'sport_anchor'
    | 'wake'
    | 'outfit'
    | 'transit'
    | 'cross_chat'
    | 'plan_day'
    | 'emergency'
    | 'pack';
  /** Route-Button nur wenn soon/explicit */
  noRouteUnlessSoon?: boolean;
  /** Muss Tennis-/Sportort klären */
  mustClarifyVenue?: boolean;
  /** Mitdenken: Wecker ← Leave ← Frühstück ← Match */
  thinkAheadWakeBreakfast?: boolean;
  /** Kein erfundenes Erkunden */
  noInventedExplore?: boolean;
  /** Stadt Lübeck im Fokus */
  city?: 'Lübeck';
  /** Cross-thread: Anapher zum Vorherigen */
  resumeThread?: boolean;
};

export type ScenarioTemplate = {
  id: string;
  category: string;
  /** Platzhalter: {meal} {time} {sight} {cuisine} … */
  patterns: string[];
  expect: ScenarioExpect;
};

const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack', 'Kaffee'];
const TIMES = [
  'jetzt',
  'in 10 Minuten',
  'um 12 Uhr',
  'um 17 Uhr',
  'um 19:30',
  'morgen früh',
  'heute Abend',
];
const CUISINES = [
  'Italiener',
  'Fisch',
  'Marzipan-Café',
  'Burger',
  'vegetarisch',
  'glutenfrei',
  'günstig',
  'mit Aussicht',
];
const SIGHTS = [
  'Holstentor',
  'Marienkirche',
  'Altstadt',
  'Buddenbrookhaus',
  'Museumshafen',
  'Petrikirche',
  'Salzspeicher',
  'Travemünde',
];
const SPORT = [
  'Tennis-Match',
  'Training',
  'Doppel',
  'Turnier',
  'Phoenix Club',
];
const HOTEL_NEEDS = [
  'günstig',
  'nahe Tennis',
  'mit Frühstück',
  'Parkplatz',
  'ruhig',
  'Altstadt',
];

export const LUEBECK_SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'din_now',
    category: 'dining',
    patterns: [
      'Wo gibt es gutes {cuisine} in Lübeck?',
      'Ich hab Hunger — {meal} in Lübeck',
      'Restaurant für {meal} {time}',
      'Finde mir ein {cuisine} Restaurant in der Altstadt',
      'Speisekarte von dem Restaurant bitte',
    ],
    expect: {
      family: 'dining',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'din_plan',
    category: 'dining_plan',
    patterns: [
      'Abendessen um 19 Uhr in Lübeck planen',
      'Reservierung {cuisine} heute Abend',
      'Zwischen den Matches kurz {meal}',
    ],
    expect: {
      family: 'plan_day',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
      noInventedExplore: true,
    },
  },
  {
    id: 'hotel',
    category: 'hotel',
    patterns: [
      'Hotel in Lübeck von Donnerstag bis Samstag {need}',
      'Günstigstes Hotel in Lübeck {need}',
      'Unterkunft in Lübeck fürs Wochenende',
    ],
    expect: {
      family: 'hotel',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'hotel_tennis',
    category: 'hotel',
    patterns: [
      'Hotel nahe den Tennisplätzen in Lübeck',
      'Günstigstes Hotel nahe Tennis in Lübeck',
      'Unterkunft bei den Tennisplätzen',
    ],
    expect: {
      family: 'hotel',
      city: 'Lübeck',
      mustClarifyVenue: true,
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'sport',
    category: 'sport',
    patterns: [
      'Morgen um 10 Uhr {sport} in Lübeck',
      'Wir müssen um 10 am Tennisplatz sein',
      'Match um 14 Uhr, davor noch Freigang',
      'Training 10–12, danach Stadt angucken',
    ],
    expect: {
      family: 'sport_anchor',
      city: 'Lübeck',
      thinkAheadWakeBreakfast: true,
      noInventedExplore: true,
      mustClarifyVenue: true,
    },
  },
  {
    id: 'wake',
    category: 'wake',
    patterns: [
      'Stell einen Wecker fürs Match um 10',
      'Wann muss ich aufstehen wenn wir um 10 spielen?',
      'Wecker stellen, wir wollen vorher frühstücken',
      'Morgen Match 10 Uhr — Wecker und Frühstück mitdenken',
    ],
    expect: {
      family: 'wake',
      thinkAheadWakeBreakfast: true,
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'tour',
    category: 'tour',
    patterns: [
      '2 Stunden Lübeck Altstadt erkunden',
      'Zehl mir die Highlights in Lübeck',
      'Tour zum {sight}',
      'Was muss man in Lübeck gesehen haben?',
    ],
    expect: {
      family: 'tour',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'sight',
    category: 'sight',
    patterns: [
      'Erzähl mir was zum {sight}',
      'Öffnungszeiten {sight}',
      'Tickets für {sight}',
      'Bring mich zum {sight}',
    ],
    expect: {
      family: 'sight',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'outfit',
    category: 'outfit',
    patterns: [
      'Was soll ich heute Nachmittag anziehen?',
      'Outfit fürs Match und danach Stadt',
      'Wird es um 17 Uhr kalt in Lübeck?',
    ],
    expect: {
      family: 'outfit',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'transit',
    category: 'transit',
    patterns: [
      'Wie lange zum {sight} zu Fuß?',
      'ÖPNV vom Hotel zum Tennisplatz',
      'Wann müssen wir los zum Match um 10?',
      'Route vom Holstentor zum Phoenix Club',
    ],
    expect: {
      family: 'transit',
      city: 'Lübeck',
      noRouteUnlessSoon: false,
    },
  },
  {
    id: 'nav_explicit',
    category: 'transit',
    patterns: [
      'Bring mich zum Holstentor',
      'Führ mich zur Marienkirche',
      'Navigiere mich zum Tennisclub Phoenix in Lübeck',
      'Bring mich zu {sight}',
      'Fußweg zum Bahnhof Lübeck, und wenn es länger als 20 Minuten ist ÖPNV',
    ],
    expect: {
      family: 'transit',
      city: 'Lübeck',
      noRouteUnlessSoon: false,
      noInventedExplore: true,
    },
  },
  {
    id: 'multi_ramble',
    category: 'cross_chat',
    patterns: [
      'Also wir haben Hunger und danach will ich noch die Altstadt sehen und irgendwann zurück zum Hotel',
      'Parkplatz suchen und dann 2 Stunden Lübeck erkunden',
      'Günstiges Hotel und dann Abendessen und wenn Zeit ist noch ein Museum',
    ],
    expect: {
      family: 'cross_chat',
      city: 'Lübeck',
      noInventedExplore: true,
    },
  },
  {
    id: 'cross',
    category: 'cross_chat',
    patterns: [
      'Und die Speisekarte von dem Restaurant vorhin?',
      'Nochmal wegen dem Hotel — günstiger?',
      'Das Match — wann Leave-by nochmal?',
      'Kurz was ganz anderes: Toilette in der Nähe',
      'Zurück zum Abendessen — vegetarisch bitte',
    ],
    expect: {
      family: 'cross_chat',
      resumeThread: true,
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'pack',
    category: 'pack',
    patterns: [
      'Lade den Lübeck Datensatz',
      'Ich bin in Lübeck, hast du die Stadt?',
      'Möchtest du Lübeck herunterladen für bessere Infos',
    ],
    expect: {
      family: 'pack',
      city: 'Lübeck',
      noRouteUnlessSoon: true,
    },
  },
  {
    id: 'gap',
    category: 'freigang',
    patterns: [
      'Zwischen 12 und 14 haben wir Freigang — was essen?',
      'Nach dem Match bis 17 Uhr Stadt',
      'Kurzer Spaziergang in der Pause, pünktlich zurück',
    ],
    expect: {
      family: 'plan_day',
      city: 'Lübeck',
      noInventedExplore: true,
      noRouteUnlessSoon: true,
      thinkAheadWakeBreakfast: false,
    },
  },
];

function fill(pattern: string, slots: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? k);
}

function product<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((a) => list.map((b) => [...a, b])),
    [[]],
  );
}

export type ExpandedScenario = {
  id: string;
  question: string;
  expect: ScenarioExpect;
  category: string;
};

/**
 * Expandiert Templates zu vielen konkreten Fragen (Ziel ≈ 400).
 */
export function expandLuebeckScenarios(target = 400): ExpandedScenario[] {
  const out: ExpandedScenario[] = [];
  let n = 0;
  for (const tpl of LUEBECK_SCENARIO_TEMPLATES) {
    for (const pattern of tpl.patterns) {
      const needs = {
        cuisine: /\{cuisine\}/.test(pattern),
        meal: /\{meal\}/.test(pattern),
        time: /\{time\}/.test(pattern),
        sight: /\{sight\}/.test(pattern),
        sport: /\{sport\}/.test(pattern),
        need: /\{need\}/.test(pattern),
      };
      const lists: string[][] = [];
      const keys: string[] = [];
      if (needs.cuisine) {
        keys.push('cuisine');
        lists.push(CUISINES);
      }
      if (needs.meal) {
        keys.push('meal');
        lists.push(MEALS);
      }
      if (needs.time) {
        keys.push('time');
        lists.push(TIMES);
      }
      if (needs.sight) {
        keys.push('sight');
        lists.push(SIGHTS);
      }
      if (needs.sport) {
        keys.push('sport');
        lists.push(SPORT);
      }
      if (needs.need) {
        keys.push('need');
        lists.push(HOTEL_NEEDS);
      }
      if (lists.length === 0) {
        out.push({
          id: `${tpl.id}_${n++}`,
          question: pattern,
          expect: tpl.expect,
          category: tpl.category,
        });
        continue;
      }
      // Cap combinations per pattern to keep ~400 total
      const combos = product(lists).slice(0, 12);
      for (const combo of combos) {
        const slots: Record<string, string> = {};
        keys.forEach((k, i) => {
          slots[k] = combo[i]!;
        });
        out.push({
          id: `${tpl.id}_${n++}`,
          question: fill(pattern, slots),
          expect: tpl.expect,
          category: tpl.category,
        });
        if (out.length >= target) return out;
      }
    }
  }
  // Auffüllen mit Varianten-Präfixen
  const prefixes = [
    'Hey Yorro, ',
    'Kurz: ',
    'Bitte ',
    'Für uns Sportler: ',
    '',
  ];
  const base = [...out];
  for (const p of prefixes) {
    for (const s of base) {
      if (out.length >= target) return out;
      if (!p) continue;
      out.push({
        ...s,
        id: `${s.id}_pfx_${out.length}`,
        question: `${p}${s.question.charAt(0).toLowerCase()}${s.question.slice(1)}`,
      });
    }
  }
  return out.slice(0, target);
}

/** Heuristik: erwartet die Frage eine sofortige Route? */
export function utteranceImpliesSoonNav(text: string): boolean {
  return /\b(jetzt|sofort|los|bring\s+mich|führ\s+mich|navigier|in\s+10\s+min|in\s+fünf\s+min)\b/i.test(
    text,
  );
}

export function utteranceNeedsTennisClarify(text: string): boolean {
  return (
    /\btennis/i.test(text) &&
    /\b(nahe|nähe|hotel|unterkunft)\b/i.test(text) &&
    !/\b(phoenix|tc\s+\w+|tennisclub\s+\w+)\b/i.test(text)
  );
}

export function utteranceNeedsWakeBreakfastChain(text: string): boolean {
  return (
    /\b(wecker|aufstehen|match|spiel|training|10\s*uhr)\b/i.test(text) &&
    (/\b(frühstück|fruehstueck|wecker)\b/i.test(text) ||
      /\b(match|spiel|training).{0,40}(10|vormittag)/i.test(text))
  );
}
