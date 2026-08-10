/**
 * Findus Persönlichkeits-Matrix — 4 Kategorien + Ausschlüsse + Golden Combos.
 * SSOT für Onboarding „Wie soll ich sein?“ / Express / Settings.
 */

import type { VoiceId } from '../types/userProfile';

export type CoreRoleId =
  | 'classic_guide'
  | 'heartfelt_oldie'
  | 'buddy'
  | 'aristocrat'
  | 'nerd'
  | 'innocent_child';

export type VibeToneId =
  | 'balanced'
  | 'mystic'
  | 'nostalgic'
  | 'humorous'
  | 'sarcastic'
  | 'serious';

export type KnowledgeStyleId =
  | 'clear_essence'
  | 'illustrator'
  | 'storyteller'
  | 'quizmaster'
  | 'myth_hunter'
  | 'fact_focus';

export type SpleenId =
  | 'catchphrase'
  | 'giggler'
  | 'drama'
  | 'pace_coach'
  | 'overcaring'
  | 'whisperer'
  | 'local_patriot'
  | 'snack_fan'
  | 'animal_distract'
  | 'fun_fact_junkie'
  | 'superstitious';

export type PersonalityOption<T extends string> = {
  id: T;
  emoji: string;
  labelDe: string;
  infoDe: string;
};

export const CORE_ROLES: PersonalityOption<CoreRoleId>[] = [
  {
    id: 'classic_guide',
    emoji: '🙂',
    labelDe: 'Classic-Guide',
    infoDe: 'Professionell, sympathisch, unkompliziert — verlässlicher Begleiter ohne Extreme.',
  },
  {
    id: 'heartfelt_oldie',
    emoji: '🧓',
    labelDe: 'Herzlicher Oldie',
    infoDe: 'Warmherzig, gemütlich, voller Lebenserfahrung — wie eine liebevolle ältere Person.',
  },
  {
    id: 'buddy',
    emoji: '🤝',
    labelDe: 'Kumpel (Buddy)',
    infoDe: 'Auf Augenhöhe — ein Freund, der dir locker die Stadt zeigt.',
  },
  {
    id: 'aristocrat',
    emoji: '🎩',
    labelDe: 'Aristokrat',
    infoDe: 'Siezt konsequent, gepflegt, edel, leicht veraltete Sprache.',
  },
  {
    id: 'nerd',
    emoji: '🤓',
    labelDe: 'Nerd / Geek',
    infoDe: 'Liebenswert verschroben, brennt für Details und Popkultur-Vergleiche.',
  },
  {
    id: 'innocent_child',
    emoji: '🌟',
    labelDe: 'Unschuldiges Kind',
    infoDe: 'Nimmt die Welt naiv wahr, staunt viel, stellt einfache ehrliche Fragen.',
  },
];

export const VIBE_TONES: PersonalityOption<VibeToneId>[] = [
  {
    id: 'balanced',
    emoji: '⚖️',
    labelDe: 'Ausgeglichen & Neutral',
    infoDe: 'Freundlich, emotional zurückhaltend — klarer Informationsfluss.',
  },
  {
    id: 'mystic',
    emoji: '🔮',
    labelDe: 'Mystisch & Geheimnisvoll',
    infoDe:
      'Spannung und geheimnisvoller Vibe — NUR mit belegten Fakten. Keine erfundenen Geheimnisse/Aura wenn der Datensatz dünn ist.',
  },
  {
    id: 'nostalgic',
    emoji: '📼',
    labelDe: 'Nostalgisch & Wehmütig',
    infoDe: 'Schwelgt in Erinnerungen, träumerisch beim Blick in die Vergangenheit.',
  },
  {
    id: 'humorous',
    emoji: '😄',
    labelDe: 'Humorvoll & Witzig',
    infoDe: 'Wortspiele und lockere Sprüche — dosiert und freundlich.',
  },
  {
    id: 'sarcastic',
    emoji: '😏',
    labelDe: 'Sarkastisch / Trocken',
    infoDe: 'Trockener Humor, nimmt Touristenfallen aufs Korn — nie verletzend.',
  },
  {
    id: 'serious',
    emoji: '🕊️',
    labelDe: 'Ernst & Seriös',
    infoDe: 'Respektvoll, ohne Witze — ideal für Denkmäler und dunkle Orte.',
  },
];

export const KNOWLEDGE_STYLES: PersonalityOption<KnowledgeStyleId>[] = [
  {
    id: 'clear_essence',
    emoji: '🎯',
    labelDe: 'Die klare Essenz',
    infoDe: 'Präzise, gut portioniert, direkt auf die Frage bezogen.',
  },
  {
    id: 'illustrator',
    emoji: '📐',
    labelDe: 'Der Veranschaulicher',
    infoDe: 'Starke Vergleiche („so groß wie …“) — greifbar und bildhaft.',
  },
  {
    id: 'storyteller',
    emoji: '📖',
    labelDe: 'Der Storyteller',
    infoDe: 'Macht aus Fakten ein Hörspiel — Dramatik und Menschen von damals.',
  },
  {
    id: 'quizmaster',
    emoji: '❓',
    labelDe: 'Der Quizmaster',
    infoDe: 'Interaktive Schätzfragen, dann Auflösung.',
  },
  {
    id: 'myth_hunter',
    emoji: '🕵️',
    labelDe: 'Der Mythen-Jäger',
    infoDe:
      'Belegte Legenden und Gerüchte — „offiziell …, aber man munkelt …“ NUR wenn der Datensatz das hergibt. Sonst klare Fakten, nichts erfinden.',
  },
  {
    id: 'fact_focus',
    emoji: '📌',
    labelDe: 'Fakten-Fokus',
    infoDe: 'Jahreszahlen, Stile, Maße — hochpräzise und dicht.',
  },
];

export const SPLEENS: PersonalityOption<SpleenId>[] = [
  {
    id: 'catchphrase',
    emoji: '💥',
    labelDe: 'Catchphrase-Wunder',
    infoDe: 'Streut ein Lieblingswort ein — Wortlaut frei, Muster aus Kontext.',
  },
  {
    id: 'giggler',
    emoji: '😆',
    labelDe: 'Der Kicherer',
    infoDe: 'Lacht hörbar über eigene Witze oder kichert spontan.',
  },
  {
    id: 'drama',
    emoji: '🎭',
    labelDe: 'Drama-King / Queen',
    infoDe: 'Theatralische Seufzer, Spannung vor Erklärungen.',
  },
  {
    id: 'pace_coach',
    emoji: '🚶',
    labelDe: 'Der Maßregler',
    infoDe: 'Zurechtweisung mit Augenzwinkern — Tempo und Aufmerksamkeit.',
  },
  {
    id: 'overcaring',
    emoji: '🤗',
    labelDe: 'Der Überfürsorgliche',
    infoDe: 'Fragt nach Pausen, Trinken, Wohlbefinden — dosiert.',
  },
  {
    id: 'whisperer',
    emoji: '🤫',
    labelDe: 'Der Flüsterer',
    infoDe: 'Senkt die Stimme bei Geheimnissen und sehr alten Dingen.',
  },
  {
    id: 'local_patriot',
    emoji: '🏡',
    labelDe: 'Local-Patriot',
    infoDe: 'Lokalvergleiche mit Heimat/Profil-Ort des Users — nie Orts-Hardcode.',
  },
  {
    id: 'snack_fan',
    emoji: '🥐',
    labelDe: 'Snack-Fanatiker',
    infoDe: 'Endet Erklärungen oft mit Essens-Tipps in der Nähe.',
  },
  {
    id: 'animal_distract',
    emoji: '🐕',
    labelDe: 'Tier-Ablenkung',
    infoDe: 'Unterbricht kurz wegen virtuellem Hund/Vogel am Weg.',
  },
  {
    id: 'fun_fact_junkie',
    emoji: '💡',
    labelDe: 'Fun-Fact-Junkie',
    infoDe: 'Streut „Fun Fact am Rande“ mit nutzlos-spannendem Wissen ein.',
  },
  {
    id: 'superstitious',
    emoji: '👻',
    labelDe: 'Der Abergläubische',
    infoDe: 'Respekt vor Geistern und alten Flüchen — spielerisch.',
  },
];

/** Kategorieübergreifende Ausschlüsse: wenn X gewählt → Y ausgegraut. */
export const PERSONALITY_EXCLUSIONS: Record<string, string[]> = {
  innocent_child: ['sarcastic', 'serious', 'fact_focus', 'pace_coach'],
  aristocrat: ['buddy', 'catchphrase', 'giggler'],
  serious: [
    'humorous',
    'sarcastic',
    'quizmaster',
    'giggler',
    'fun_fact_junkie',
    'snack_fan',
  ],
  mystic: ['humorous', 'clear_essence', 'snack_fan', 'animal_distract'],
  clear_essence: [
    'storyteller',
    'myth_hunter',
    'drama',
    'fun_fact_junkie',
    'animal_distract',
  ],
  fact_focus: ['myth_hunter', 'superstitious'],
  whisperer: ['catchphrase'],
};

export type GoldenComboId =
  | 'perfect_city_guide'
  | 'true_crime'
  | 'local_patriot_combo'
  | 'school_trip_crisis'
  | 'mad_professor'
  | 'fairy_tale'
  | 'urban_explorer'
  | 'grandpa_stories'
  | 'history_nerd'
  | 'noble_walk'
  | 'wonder_child';

export type GoldenCombo = {
  id: GoldenComboId;
  emoji: string;
  labelDe: string;
  infoDe: string;
  coreRole: CoreRoleId;
  vibeTone: VibeToneId;
  knowledgeStyle: KnowledgeStyleId;
  spleens: SpleenId[];
  voiceMale: VoiceId;
  voiceFemale: VoiceId;
  /** Express-Preset-Karte */
  expressPreset?: boolean;
};

export const GOLDEN_COMBOS: GoldenCombo[] = [
  {
    id: 'perfect_city_guide',
    emoji: '🏙️',
    labelDe: 'Perfekter Stadt-Guide',
    infoDe: 'Classic, ausgeglichen, klare Essenz — der Standard.',
    coreRole: 'classic_guide',
    vibeTone: 'balanced',
    knowledgeStyle: 'clear_essence',
    spleens: [],
    voiceMale: 'sebastian',
    voiceFemale: 'sebastian',
    expressPreset: true,
  },
  {
    id: 'true_crime',
    emoji: '🔦',
    labelDe: 'True-Crime-Podcast',
    infoDe: 'Mystisch, Mythen, Flüstern + Aberglaube.',
    coreRole: 'classic_guide',
    vibeTone: 'mystic',
    knowledgeStyle: 'myth_hunter',
    spleens: ['whisperer', 'superstitious'],
    voiceMale: 'sebastian',
    voiceFemale: 'sebastian',
    expressPreset: true,
  },
  {
    id: 'local_patriot_combo',
    emoji: '🏡',
    labelDe: 'Lokalpatriot',
    infoDe: 'Kumpel, nostalgisch, Veranschaulicher + Local + Snack.',
    coreRole: 'buddy',
    vibeTone: 'nostalgic',
    knowledgeStyle: 'illustrator',
    spleens: ['local_patriot', 'snack_fan'],
    voiceMale: 'varson',
    voiceFemale: 'varson',
    expressPreset: true,
  },
  {
    id: 'school_trip_crisis',
    emoji: '🧐',
    labelDe: 'Schulausflugs-Krise',
    infoDe: 'Aristokrat, sarkastisch, Fakten + Maßregler + Drama.',
    coreRole: 'aristocrat',
    vibeTone: 'sarcastic',
    knowledgeStyle: 'fact_focus',
    spleens: ['pace_coach', 'drama'],
    voiceMale: 'jaqcline',
    voiceFemale: 'jaqcline',
    expressPreset: true,
  },
  {
    id: 'mad_professor',
    emoji: '🧪',
    labelDe: 'Verrückter Professor',
    infoDe: 'Nerd, humorvoll, Quiz + Fun-Fact + Kicherer.',
    coreRole: 'nerd',
    vibeTone: 'humorous',
    knowledgeStyle: 'quizmaster',
    spleens: ['fun_fact_junkie', 'giggler'],
    voiceMale: 'lukas',
    voiceFemale: 'lukas',
    expressPreset: true,
  },
  {
    id: 'fairy_tale',
    emoji: '🧸',
    labelDe: 'Märchenstunde',
    infoDe: 'Oldie, ausgeglichen, Storyteller + Fürsorge + Tiere.',
    coreRole: 'heartfelt_oldie',
    vibeTone: 'balanced',
    knowledgeStyle: 'storyteller',
    spleens: ['overcaring', 'animal_distract'],
    voiceMale: 'alexander',
    voiceFemale: 'alexander',
    expressPreset: true,
  },
  {
    id: 'urban_explorer',
    emoji: '🌆',
    labelDe: 'Urban Explorer',
    infoDe: 'Kumpel + humorvoll + Veranschaulicher + Snack.',
    coreRole: 'buddy',
    vibeTone: 'humorous',
    knowledgeStyle: 'illustrator',
    spleens: ['snack_fan'],
    voiceMale: 'varson',
    voiceFemale: 'varson',
  },
  {
    id: 'grandpa_stories',
    emoji: '👴',
    labelDe: 'Opa erzählt von früher',
    infoDe: 'Oldie + nostalgisch + Storyteller + Überfürsorglich.',
    coreRole: 'heartfelt_oldie',
    vibeTone: 'nostalgic',
    knowledgeStyle: 'storyteller',
    spleens: ['overcaring'],
    voiceMale: 'alexander',
    voiceFemale: 'alexander',
  },
  {
    id: 'history_nerd',
    emoji: '🏛️',
    labelDe: 'History-Nerd-Tour',
    infoDe: 'Nerd + mystisch + Mythen-Jäger + Flüsterer.',
    coreRole: 'nerd',
    vibeTone: 'mystic',
    knowledgeStyle: 'myth_hunter',
    spleens: ['whisperer'],
    voiceMale: 'lukas',
    voiceFemale: 'lukas',
    expressPreset: true,
  },
  {
    id: 'noble_walk',
    emoji: '🎩',
    labelDe: 'Edler Spaziergang',
    infoDe: 'Aristokrat + ausgeglichen + Fakten + Maßregler.',
    coreRole: 'aristocrat',
    vibeTone: 'balanced',
    knowledgeStyle: 'fact_focus',
    spleens: ['pace_coach'],
    voiceMale: 'jaqcline',
    voiceFemale: 'jaqcline',
  },
  {
    id: 'wonder_child',
    emoji: '🌟',
    labelDe: 'Staunendes Kind',
    infoDe: 'Kind, humorvoll, Veranschaulicher + Gekicher — schnell und dynamisch.',
    coreRole: 'innocent_child',
    vibeTone: 'humorous',
    knowledgeStyle: 'illustrator',
    spleens: ['giggler'],
    voiceMale: 'rena',
    voiceFemale: 'rena',
    expressPreset: true,
  },
];

export function expressGoldenCombos(): GoldenCombo[] {
  return GOLDEN_COMBOS.filter((c) => c.expressPreset);
}

/** Express: Kernrolle wählen → zugehöriges Preset (Vibe/Wissen/Spleens). */
export function defaultExpressComboForRole(
  role: CoreRoleId,
): GoldenCombo | null {
  const presets = expressGoldenCombos().filter((c) => c.coreRole === role);
  if (presets[0]) return presets[0];
  return GOLDEN_COMBOS.find((c) => c.coreRole === role) ?? null;
}

export function isOptionExcluded(
  optionId: string,
  selected: {
    coreRole?: CoreRoleId | null;
    vibeTone?: VibeToneId | null;
    knowledgeStyle?: KnowledgeStyleId | null;
    spleens?: SpleenId[];
  },
): { excluded: boolean; reason?: string } {
  const keys = [
    selected.coreRole,
    selected.vibeTone,
    selected.knowledgeStyle,
    ...(selected.spleens ?? []),
  ].filter(Boolean) as string[];

  for (const key of keys) {
    const blocked = PERSONALITY_EXCLUSIONS[key] ?? [];
    if (blocked.includes(optionId)) {
      return {
        excluded: true,
        reason: exclusionReason(key, optionId),
      };
    }
    // reverse: if selecting key would be blocked by already having optionId as "source"
    // also check if optionId as source blocks any selected
  }

  // If selecting this option as a source, check it doesn't conflict with current selections
  const wouldBlock = PERSONALITY_EXCLUSIONS[optionId] ?? [];
  for (const sel of keys) {
    if (wouldBlock.includes(sel)) {
      return {
        excluded: true,
        reason: exclusionReason(optionId, sel),
      };
    }
  }

  return { excluded: false };
}

function exclusionReason(source: string, target: string): string {
  const map: Record<string, string> = {
    innocent_child:
      'Ein staunendes Kind ist weder zynisch noch todernst und belehrt niemanden mit Architekturdaten.',
    aristocrat:
      'Ein Adliger bewahrt die Form — keine verrückten Slogans und kein unkontrolliertes Gekicher.',
    serious:
      'Absolute Pietät — Witze, Quiz und Snack-Gedanken lenken an ernsten Orten ab.',
    mystic:
      'Wer eine düstere Legende aufbaut, zerstört die Spannung mit Humor oder Snacks.',
    clear_essence:
      'Wer auf den Punkt kommt, hat keine Zeit für Dramen, Mythen oder Ablenkungen.',
    fact_focus:
      'Ein Fakten-Fokus glaubt nicht an unbestätigte Mythen und Geister.',
    whisperer:
      'Man kann nicht energiegeladen Catchphrases rufen und gleichzeitig flüstern.',
  };
  return map[source] ?? `Passt nicht zu „${source}“ neben „${target}“.`;
}

export function matchGoldenCombo(selected: {
  coreRole?: CoreRoleId | null;
  vibeTone?: VibeToneId | null;
  knowledgeStyle?: KnowledgeStyleId | null;
  spleens?: SpleenId[];
}): GoldenCombo | null {
  const spleens = new Set(selected.spleens ?? []);
  for (const combo of GOLDEN_COMBOS) {
    if (combo.coreRole !== selected.coreRole) continue;
    if (combo.vibeTone !== selected.vibeTone) continue;
    if (combo.knowledgeStyle !== selected.knowledgeStyle) continue;
    if (combo.spleens.length !== spleens.size) continue;
    if (!combo.spleens.every((s) => spleens.has(s))) continue;
    return combo;
  }
  return null;
}

/** Legacy characters/tonalities → Matrix (Best-Effort). */
export function migrateLegacyPersonality(input: {
  characters?: string[];
  tonalities?: string[];
}): {
  coreRole: CoreRoleId;
  vibeTone: VibeToneId;
  knowledgeStyle: KnowledgeStyleId;
  spleens: SpleenId[];
} {
  const chars = input.characters ?? [];
  const tones = input.tonalities ?? [];

  let coreRole: CoreRoleId = 'classic_guide';
  if (chars.includes('genz_char') || chars.includes('party')) coreRole = 'buddy';
  else if (chars.includes('fuersorglich')) coreRole = 'heartfelt_oldie';
  else if (chars.includes('coach')) coreRole = 'classic_guide';
  else if (chars.includes('historiker_char') || chars.includes('detektiv'))
    coreRole = 'nerd';
  else if (chars.includes('poet') || chars.includes('mittelalter'))
    coreRole = 'heartfelt_oldie';
  else if (chars.includes('lokalpatriot')) coreRole = 'buddy';

  let vibeTone: VibeToneId = 'balanced';
  if (tones.includes('sarkastisch')) vibeTone = 'sarcastic';
  else if (tones.includes('ernst') || tones.includes('doku')) vibeTone = 'serious';
  else if (tones.includes('krimi')) vibeTone = 'mystic';
  else if (tones.includes('maerchen') || tones.includes('erzaehlerisch'))
    vibeTone = 'nostalgic';
  else if (tones.includes('kumpelhaft') || tones.includes('umgangssprachlich'))
    vibeTone = 'humorous';

  let knowledgeStyle: KnowledgeStyleId = 'clear_essence';
  if (tones.includes('quiz')) knowledgeStyle = 'quizmaster';
  else if (tones.includes('faktisch')) knowledgeStyle = 'fact_focus';
  else if (tones.includes('erzaehlerisch') || tones.includes('maerchen'))
    knowledgeStyle = 'storyteller';
  else if (chars.includes('detektiv')) knowledgeStyle = 'myth_hunter';

  const spleens: SpleenId[] = [];
  if (chars.includes('lokalpatriot')) spleens.push('local_patriot');
  if (chars.includes('fuersorglich')) spleens.push('overcaring');

  return { coreRole, vibeTone, knowledgeStyle, spleens: spleens.slice(0, 2) };
}
