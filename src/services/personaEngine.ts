/**
 * Persona-Engine + Unified Yorro Master-Prompt (Single Source of Truth).
 */

import type {
  AnswerStyle,
  BudgetCategory,
  EnergyLevel,
  FindusPersona,
  FindusToneStyle,
  MasterPromptContext,
  MobilityMode,
  PaceMode,
  PersonaEngineProfile,
  PoiImportance,
  TouristVsInsider,
  TravelParty,
  TravelPurpose,
  UserProfile,
} from '../types/userProfile';
import { findusCorePromptAppendix } from './concierge/findusResponsePolicy';
import { getCachedUserProfile } from './userProfileService';
import { isLowChatterActive, lowChatterPromptBlock } from './persona/lowChatterMode';
import { empathyEnginePromptBlock } from './persona/empathyEngine';
import { softAddressingPromptBlock } from './memory/preferenceCaptureMiddleware';
import { learnedRulesMasterPromptBlock } from './memory/correctionLearning';
import {
  blueprintsToPseudoRules,
  formatProductBlueprintsPromptBlock,
} from './memory/betaSituationSync';
import { getCachedSituationBlueprintsSync } from './memory/betaSituationQueue';
import { temporalPromptBlock } from './time/temporalGerman';
import { antiHallucinationPromptBlock } from './planning/multiIntentFanout';
import { contextTriggerPromptBlock } from './ui/contextTriggerMatrix';
import type {
  CoreRoleId,
  VibeToneId,
} from '../constants/personalityMatrix';
import {
  buildCharacterFlavorFromMatrix,
  buildPersonalityMatrixPromptBlock,
  resolveEffectivePersonalityMatrix,
} from './persona/personalityMatrixPrompt';
import { filterSpleensForStress, resolveSituationContext } from './persona/situationGate';

const PERSONA_FROM_CHAR: Record<string, FindusPersona> = {
  standard_char: 'standard',
  genz_char: 'gen_z',
  party: 'party_guide',
  coach: 'coach',
  poet: 'poet',
  historiker_char: 'historiker',
  mittelalter: 'mittelalter',
  fuersorglich: 'coach',
  lokalpatriot: 'standard',
  detektiv: 'historiker',
  reiseblogger: 'gen_z',
};

const CHARACTER_FLAVOR: Record<string, string> = {
  standard_char:
    'Standard: freundlich, klar, alltagstauglich — keine Extreme.',
  fuersorglich:
    'Fürsorglich: achte auf Pausen, Sicherheit, Toiletten und Wohlbefinden — familienfreundlich.',
  lokalpatriot:
    'Insider: Nachbarschaftsperspektive, echte Tipps vor Touristenfallen.',
  detektiv: 'Neugierig: Spuren legen, Rätsel andeuten, nachfragen.',
  reiseblogger:
    'Weltenbummler: Foto-Winkel, Geheimtipps, Caps, teilbare Momente.',
  party: 'Nightlife: Energie hoch, Bars/Clubs und Treffpunkte priorisieren.',
  coach: 'Effizient: kurz, klar, zielorientiert — Zeit und Wege sparen.',
};

const TONE_FROM_ID: Record<string, FindusToneStyle> = {
  sarkastisch: 'sarkastisch',
  krimi: 'krimi',
  quiz: 'quizmaster',
  maerchen: 'maerchen',
  ernst: 'ernst',
  doku: 'doku',
  dokufilm: 'doku',
  humorvoll: 'kumpelhaft',
  kumpelhaft: 'kumpelhaft',
  umgangssprachlich: 'umgangssprachlich',
  erzaehlerisch: 'erzaehlerisch',
  faktisch: 'faktisch',
};

const LEGACY_TONE_MAP: Record<string, FindusToneStyle> = {
  herold: 'ernst',
  einfach: 'ernst',
  blogger: 'kumpelhaft',
  podcast: 'kumpelhaft',
};

const PURPOSE_FROM_MOTIVE: Record<string, TravelPurpose> = {
  business: 'business',
  familie: 'family',
  backpacker: 'backpacker',
  layover: 'layover',
  zwischenstopp: 'layover',
  freizeit: 'leisure',
  leisure: 'leisure',
  geschaeftsreise: 'business',
};

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

const CORE_ROLE_PERSONA: Record<CoreRoleId, FindusPersona> = {
  classic_guide: 'standard',
  heartfelt_oldie: 'coach',
  buddy: 'gen_z',
  aristocrat: 'standard',
  nerd: 'historiker',
  innocent_child: 'gen_z',
};

const VIBE_TONE_STYLE: Record<VibeToneId, FindusToneStyle> = {
  balanced: 'kumpelhaft',
  mystic: 'krimi',
  nostalgic: 'erzaehlerisch',
  humorous: 'kumpelhaft',
  sarcastic: 'sarkastisch',
  serious: 'ernst',
};

function resolvePersona(profile: UserProfile): FindusPersona {
  if (profile.personaEngine?.persona) return profile.personaEngine.persona;
  const matrix = resolveEffectivePersonalityMatrix(profile);
  if (matrix.coreRole) {
    return CORE_ROLE_PERSONA[matrix.coreRole] ?? 'standard';
  }
  for (const id of profile.characters) {
    const mapped = PERSONA_FROM_CHAR[id];
    if (mapped) return mapped;
  }
  if (profile.voiceId === 'daniel' || profile.voiceId === 'varson') return 'gen_z';
  if (profile.voiceId === 'lukas' || profile.voiceId === 'marlene') return 'historiker';
  return 'standard';
}

function resolveCharacterFlavor(profile: UserProfile): string | undefined {
  const fromMatrix = buildCharacterFlavorFromMatrix(profile);
  if (fromMatrix.trim()) return fromMatrix;
  for (const id of profile.characters) {
    if (CHARACTER_FLAVOR[id]) return CHARACTER_FLAVOR[id];
  }
  return undefined;
}

function resolveTone(profile: UserProfile): FindusToneStyle {
  if (profile.personaEngine?.toneStyle) return profile.personaEngine.toneStyle;
  const matrix = resolveEffectivePersonalityMatrix(profile);
  if (matrix.vibeTone) {
    return VIBE_TONE_STYLE[matrix.vibeTone] ?? 'kumpelhaft';
  }
  for (const id of profile.tonalities) {
    const mapped = TONE_FROM_ID[id] ?? LEGACY_TONE_MAP[id];
    if (mapped) return mapped;
  }
  if (profile.characters.includes('detektiv')) return 'krimi';
  const persona = resolvePersona(profile);
  if (persona === 'gen_z' || persona === 'party_guide') return 'kumpelhaft';
  if (persona === 'historiker') return 'doku';
  if (persona === 'poet') return 'maerchen';
  if (persona === 'coach') return 'ernst';
  return 'kumpelhaft';
}

function resolveTravelPurpose(profile: UserProfile): TravelPurpose {
  if (profile.personaEngine?.travelPurpose) {
    return profile.personaEngine.travelPurpose;
  }
  for (const id of profile.motives) {
    const mapped = PURPOSE_FROM_MOTIVE[id];
    if (mapped) return mapped;
  }
  if (profile.travelParty === 'family') return 'family';
  if (profile.socialDynamics.includes('familie')) return 'family';
  return 'leisure';
}

function resolveTravelParty(profile: UserProfile): TravelParty {
  if (profile.travelParty) return profile.travelParty;
  if (profile.motives.includes('familie')) return 'family';
  if (
    profile.socialDynamics.includes('date') ||
    profile.socialDynamics.includes('date_trip')
  ) {
    return 'date';
  }
  if (
    profile.socialDynamics.includes('zu_zweit') ||
    profile.socialDynamics.includes('paar')
  ) {
    return 'couple';
  }
  if (
    profile.socialDynamics.includes('allein') ||
    profile.socialDynamics.includes('solo')
  ) {
    return 'solo';
  }
  if (
    profile.socialDynamics.includes('team') ||
    profile.socialDynamics.includes('freundesgruppe') ||
    profile.extraTraits.includes('freundesgruppe')
  ) {
    return 'friends';
  }
  if (profile.socialDynamics.includes('familie')) return 'family';
  return 'solo';
}

function resolveMobility(profile: UserProfile): MobilityMode {
  if (profile.mobilityMode) return profile.mobilityMode;
  if (profile.personaEngine?.mobilityMode) {
    return profile.personaEngine.mobilityMode;
  }
  const mp = profile.mobilityPrefs ?? {};
  if (mp.walk === 'primary') return 'foot';
  if (mp.bike === 'own' || mp.bike === 'rent') return 'bike';
  // E-Scooter wie Fahrrad
  if (mp.scooter === 'own' || mp.scooter === 'rent') return 'bike';
  if (mp.transit === 'love') return 'public_transit';
  if (mp.car === 'own' || mp.car === 'own_use') return 'car';
  if (mp.walk === 'rather_not' && mp.transit !== 'avoid') {
    return 'public_transit';
  }
  const prefs = profile.experiencePrefs ?? {};
  if (prefs.fahrrad === 'yes' || prefs.eroller === 'yes') return 'bike';
  if (prefs.oepnv === 'yes') return 'public_transit';
  if (prefs.auto === 'yes') return 'car';
  if (prefs.fuss === 'yes' || prefs.fahrrad === 'no') return 'foot';
  return 'foot';
}

function resolvePace(profile: UserProfile): PaceMode {
  if (profile.personaEngine?.pace) return profile.personaEngine.pace;
  if (profile.tourLengthPref === 'fewer_stops') return 'relaxed';
  if (
    profile.tourLengthPref === 'more_stops' ||
    profile.tourLengthPref === 'max_stops'
  ) {
    return 'fast_explore';
  }
  if (profile.energyLevel === 'low') return 'relaxed';
  if (profile.energyLevel === 'high' || profile.energyLevel === 'extreme') {
    return 'fast_explore';
  }
  const access = profile.accessibility;
  if (
    access.includes('gehbehindert') ||
    access.includes('schwanger') ||
    access.includes('kinderwagen') ||
    access.includes('rollstuhl') ||
    profile.characters.includes('fuersorglich')
  ) {
    return 'relaxed';
  }
  if (profile.experiencePrefs?.entspannt === 'yes') return 'relaxed';
  if (resolveTravelPurpose(profile) === 'layover') return 'fast_explore';
  if (profile.motives.includes('business')) return 'fast_explore';
  return 'relaxed';
}

function resolveEnergy(profile: UserProfile): EnergyLevel {
  if (profile.energyLevel) return profile.energyLevel;
  if (profile.personaEngine?.energyLevel) {
    return profile.personaEngine.energyLevel;
  }
  return resolvePace(profile) === 'fast_explore' ? 'high' : 'medium';
}

function resolveBudget(profile: UserProfile): BudgetCategory {
  if (profile.budgetCategory) return profile.budgetCategory;
  const b = profile.experiencePrefs?.budget;
  if (b === 'no') return 'sparsam';
  if (b === 'yes') return 'komfort';
  return 'mittel';
}

function resolveAnswerStyle(profile: UserProfile): AnswerStyle {
  if (profile.answerStyle) return profile.answerStyle;
  if (profile.personaEngine?.answerStyle) {
    return profile.personaEngine.answerStyle;
  }
  if (profile.dataSaverMode) return 'short';
  if (resolveTravelPurpose(profile) === 'layover') return 'short';
  // Neue Profile / unset → kurz (2–4 Sätze), nicht ausführlich
  return 'short';
}

function resolveTouristMode(profile: UserProfile): TouristVsInsider {
  const must = profile.mustHaveStyles ?? [];
  if (must.length > 0) {
    const place = must.filter((t) => t !== 'nightlife');
    if (place.length === 1) return place[0] as TouristVsInsider;
    if (place.length > 1) return 'mix';
    return 'mix';
  }
  if (profile.touristMode) return profile.touristMode;
  const override =
    profile.personaEngine?.preferences?.touristSpotsVsLocalSecrets;
  if (override) return override;
  if (profile.characters.includes('lokalpatriot')) return 'insider';
  const prefs = profile.experiencePrefs ?? {};
  if (prefs.geheimtipps === 'yes' || prefs.insider === 'yes' || prefs.weg_vom_trubel === 'yes') {
    return 'insider';
  }
  if (
    prefs.sehenswuerdigkeiten === 'yes' ||
    prefs.tourist === 'yes' ||
    prefs.typisch_touri === 'yes'
  ) {
    return 'tourist';
  }
  return 'mix';
}

function resolveDietary(profile: UserProfile): string[] {
  const fromOverride =
    profile.personaEngine?.preferences?.dietaryRestrictions ?? [];
  const fromTags = profile.dietaryTags ?? [];
  const fromPrefs: string[] = [];
  const prefs = profile.experiencePrefs ?? {};
  if (prefs.vegetarisch === 'yes') fromPrefs.push('vegetarisch');
  if (prefs.vegan === 'yes') fromPrefs.push('vegan');
  if (prefs.fisch === 'no') fromPrefs.push('kein Fisch');
  if (prefs.fleisch === 'no') fromPrefs.push('kein Fleisch');
  if (fromTags.includes('fisch')) fromPrefs.push('Fisch');
  if (fromTags.includes('kein_fisch')) fromPrefs.push('kein Fisch');

  const allergyTags = profile.allergyTags ?? [];
  if (allergyTags.includes('fisch')) fromPrefs.push('kein Fisch');

  const fromLearned: string[] = [];
  for (const fact of profile.learnedFacts ?? []) {
    const lower = fact.toLowerCase();
    if (/vegetar/.test(lower)) fromLearned.push('vegetarisch');
    if (/vegan/.test(lower)) fromLearned.push('vegan');
    if (/kein\s*fisch|ohne\s*fisch/.test(lower)) fromLearned.push('kein Fisch');
    if (/kein\s*fleisch|ohne\s*fleisch/.test(lower)) {
      fromLearned.push('kein Fleisch');
    }
  }

  return uniq([...fromOverride, ...fromTags, ...fromPrefs, ...fromLearned]);
}

function resolveAllergies(profile: UserProfile): string[] {
  const fromTags = (profile.allergyTags ?? [])
    .filter((id) => id !== 'keine')
    .map((id) => {
      // lazy label map without circular import weight
      const labels: Record<string, string> = {
        nuesse: 'Nüsse',
        erdnuesse: 'Erdnüsse',
        laktose: 'Laktose',
        milchprotein: 'Milchprotein',
        gluten_zoeliakie: 'Gluten / Zöliakie',
        ei: 'Ei',
        soja: 'Soja',
        fisch: 'Fisch',
        schalentiere: 'Schalentiere',
        sesam: 'Sesam',
        sellerie: 'Sellerie',
        senf: 'Senf',
        sulfite: 'Sulfite',
        histamin: 'Histamin',
        fructose: 'Fructose',
        lupinen: 'Lupinen',
        weichtiere: 'Weichtiere',
        schwein: 'Schwein / Gelatine',
        alkohol: 'Alkohol',
        pollen: 'Pollen',
        hausstaub: 'Hausstaub',
      };
      return labels[id] ?? id;
    });
  const fromField = (profile.allergies ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^keine$/i.test(s));
  const fromAccess = profile.accessibility.includes('allergiker')
    ? ['Allergien beachten']
    : [];
  if ((profile.allergyTags ?? []).includes('keine') && fromTags.length === 0 && fromField.length === 0) {
    return [];
  }
  return uniq([...fromTags, ...fromField, ...fromAccess]);
}

function resolveDislikes(profile: UserProfile): string[] {
  const fromOverride = profile.personaEngine?.preferences?.dislikes ?? [];
  const prefs = profile.experiencePrefs ?? {};
  const fromPrefs: string[] = [];
  if (prefs.kirchen === 'no') fromPrefs.push('keine Kirchen');
  if (prefs.museen === 'no') fromPrefs.push('keine Museen');
  if (prefs.nachtleben === 'no') fromPrefs.push('kein Nachtleben');
  if (prefs.jahreszahlen === 'no') fromPrefs.push('keine Jahreszahlen');

  const avoid = (profile.avoidExperience ?? '').trim();
  if (avoid) fromPrefs.push(avoid);

  const fromLearned: string[] = [];
  for (const fact of profile.learnedFacts ?? []) {
    const lower = fact.toLowerCase();
    if (/keine?\s*kirche|mag\s+keine\s+kirche/.test(lower)) {
      fromLearned.push('keine Kirchen');
    }
    if (/keine?\s*museum|mag\s+keine\s+museen/.test(lower)) {
      fromLearned.push('keine Museen');
    }
    if (/lange\s+(fuß|fuss|wege)|keine\s+langen/.test(lower)) {
      fromLearned.push('keine langen Fußwege');
    }
    // Soft-Anrede-Fakten ≠ hartes Verbot (sonst steifer Ton)
    if (/^anrede:/i.test(fact)) {
      /* softAddressingPromptBlock */
    } else if (
      /will\s+nicht.*kumpel|nicht\s+.*kumpelhaft|kein\s+kumpel|sachlicher\s+ton/i.test(
        lower,
      )
    ) {
      fromLearned.push('Kumpel-Anrede sparsam');
    }
  }

  return uniq([...fromOverride, ...fromPrefs, ...fromLearned]);
}

/** Löst das vollständige 4-Säulen-Profil aus dem User-Store. */
export function resolvePersonaEngine(
  profile?: UserProfile | null,
): PersonaEngineProfile {
  const p = profile ?? getCachedUserProfile();
  const basePrefs = p?.experiencePrefs ?? {};
  const accessIds = p?.accessibility ?? [];
  const overridePrefs = p?.personaEngine?.preferences ?? {};

  const wheelchairRequired =
    accessIds.includes('rollstuhl') || accessIds.includes('kinderwagen');
  const visuallyImpaired = accessIds.includes('sehbehindert');
  const hearingImpaired = accessIds.includes('hoerbehindert');
  const pregnantOrLowStamina =
    accessIds.includes('schwanger') ||
    accessIds.includes('gehbehindert') ||
    accessIds.includes('kruecke') ||
    accessIds.includes('rollstuhl');
  const noiseSensitive = accessIds.includes('lautstaerke');
  const withDog = accessIds.includes('hunde');

  const age =
    p?.age != null && Number.isFinite(p.age) ? Number(p.age) : undefined;

  const touristMode = p ? resolveTouristMode(p) : 'mix';

  return {
    persona: p ? resolvePersona(p) : 'standard',
    toneStyle: p ? resolveTone(p) : 'kumpelhaft',
    answerStyle: p ? resolveAnswerStyle(p) : 'detailed',
    characterFlavor: p ? resolveCharacterFlavor(p) : undefined,
    age,
    accessibility: {
      wheelchairRequired,
      visuallyImpaired,
      hearingImpaired,
      pregnantOrLowStamina,
      noiseSensitive,
      withDog,
    },
    travelPurpose: p ? resolveTravelPurpose(p) : 'leisure',
    travelParty: p ? resolveTravelParty(p) : 'solo',
    mobilityMode: p ? resolveMobility(p) : 'foot',
    timeBudgetMinutes: p?.personaEngine?.timeBudgetMinutes,
    pace: p ? resolvePace(p) : 'relaxed',
    energyLevel: p ? resolveEnergy(p) : 'medium',
    budgetCategory: p ? resolveBudget(p) : 'mittel',
    preferences: {
      wantsDatesAndHistory:
        overridePrefs.wantsDatesAndHistory ??
        !(
          basePrefs.jahreszahlen === 'no' ||
          basePrefs.geschichte === 'no'
        ),
      likesChurches:
        overridePrefs.likesChurches ?? basePrefs.kirchen !== 'no',
      likesMuseums:
        overridePrefs.likesMuseums ?? basePrefs.museen !== 'no',
      likesFamousPeople:
        overridePrefs.likesFamousPeople ?? basePrefs.personen !== 'no',
      nightlifeAndEvents:
        overridePrefs.nightlifeAndEvents ??
        (p?.mustHaveStyles?.includes('nightlife') ||
          basePrefs.nachtleben === 'yes'),
      touristSpotsVsLocalSecrets:
        overridePrefs.touristSpotsVsLocalSecrets ?? touristMode,
      dietaryRestrictions: p ? resolveDietary(p) : [],
      allergies: p ? resolveAllergies(p) : [],
      dislikes: p ? resolveDislikes(p) : [],
    },
    notificationsEnabled: p?.notificationsEnabled !== false,
    dataSaverMode: !!p?.dataSaverMode,
    learnedFacts: uniq(p?.learnedFacts ?? []),
  };
}

function parseTagsJson(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    return raw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Landmark vs. Alltagsspot — steuert Hook-Größe im Master-Prompt.
 */
export function resolvePoiImportance(poi: {
  name?: string | null;
  category?: string | null;
  kind?: string | null;
  tags_json?: string | null;
  facts?: Array<{ fact_text?: string }>;
}): PoiImportance {
  if (poi.kind === 'approach' || poi.kind === 'sub') return 'minor';

  const tags = parseTagsJson(poi.tags_json);
  const blob = [
    poi.name ?? '',
    poi.category ?? '',
    tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  if (
    /wahrzeichen|landmark|must[_-]?see|unesco|weltkulturerbe|brandenburger|kölner\s*dom|reichstag|elphi|fernsehturm/.test(
      blob,
    )
  ) {
    return 'major';
  }
  if (
    /\b(schloss|burg|dom|kathedrale|museum|denkmal|rathaus|theater|oper|bahnhof|hafen)\b/.test(
      blob,
    )
  ) {
    return 'major';
  }
  if (
    /\b(friseur|coiffeur|haarstudio|barber|salon|blumen|florist|bäck|baeck|cafe|café|imbiss|kiosk|laden|shop|boutique)\b/.test(
      blob,
    )
  ) {
    return 'minor';
  }

  const factCount = poi.facts?.length ?? 0;
  if (factCount >= 12) return 'major';
  if (factCount > 0 && factCount <= 4) return 'minor';
  return 'standard';
}

export function resolveMasterPromptContext(input?: {
  sessionVisitedCount?: number;
  poi?: {
    name?: string | null;
    category?: string | null;
    kind?: string | null;
    tags_json?: string | null;
    facts?: Array<{ fact_text?: string }>;
  } | null;
  featureTipId?: string | null;
  surplusExampleQuestion?: string | null;
  allowNavReminder?: boolean;
  featureTipsBlock?: string;
  relatedBridgeBlock?: string;
  module1Narration?: boolean;
  module1DeepDive?: boolean;
}): MasterPromptContext {
  return {
    isFirstPoi: (input?.sessionVisitedCount ?? 1) === 0,
    poiImportance: input?.poi
      ? resolvePoiImportance(input.poi)
      : 'standard',
    featureTipId: input?.featureTipId ?? null,
    surplusExampleQuestion: input?.surplusExampleQuestion ?? null,
    allowNavReminder: Boolean(input?.allowNavReminder),
    featureTipsBlock: input?.featureTipsBlock,
    relatedBridgeBlock: input?.relatedBridgeBlock,
    module1Narration: Boolean(input?.module1Narration),
    module1DeepDive: Boolean(input?.module1DeepDive),
  };
}

/**
 * UNIFIED YORRO MASTER-PROMPT — Single Source of Truth.
 * Alte forbidden-phrase-Listen und starre Dramaturgie-Blöcke gelten nicht mehr.
 */
export function buildMasterSystemInstruction(
  profile?: UserProfile | PersonaEngineProfile | null,
  context: MasterPromptContext = {
    isFirstPoi: false,
    poiImportance: 'standard',
  },
): string {
  const p: PersonaEngineProfile =
    profile &&
    ('setupComplete' in profile ||
      'characters' in profile ||
      'experiencePrefs' in profile)
      ? resolvePersonaEngine(profile as UserProfile)
      : profile && 'persona' in profile && 'preferences' in profile
        ? (profile as PersonaEngineProfile)
        : resolvePersonaEngine(null);

  const ageLabel = p.age != null ? `${p.age} Jahre` : 'unbekannt';
  const dietary = p.preferences.dietaryRestrictions.join(', ') || 'Keine';
  const allergies = p.preferences.allergies.join(', ') || 'Keine';
  const learned =
    p.learnedFacts.length > 0
      ? p.learnedFacts.map((f) => `- ${f}`).join('\n')
      : '- Noch keine speziellen Fakten gelernt.';

  const aboutMeRaw =
    profile && 'aboutMe' in profile
      ? String((profile as UserProfile).aboutMe ?? '').trim()
      : '';
  const genderRaw =
    profile && 'gender' in profile
      ? (profile as UserProfile).gender
      : null;
  const genderLabel =
    genderRaw === 'female'
      ? 'weiblich'
      : genderRaw === 'male'
        ? 'männlich'
        : genderRaw === 'diverse'
          ? 'divers'
          : null;
  const aboutBlock = [
    aboutMeRaw ? `Über den Nutzer (selbst beschrieben):\n${aboutMeRaw}` : '',
    genderLabel ? `Geschlecht: ${genderLabel}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const accessBlock = [
    p.accessibility.wheelchairRequired
      ? '⚠️ WICHTIG: Nutzer sitzt im Rollstuhl / braucht stufenfreie Wege. Erwähne ODER nutze NIEMALS Strecken mit Treppen oder unwegsamen Stufen!'
      : '',
    p.accessibility.visuallyImpaired
      ? '⚠️ WICHTIG: Nutzer ist sehbehindert. Beschreibe Klänge, Düfte, Texturen und die Atmosphäre besonders bildhaft!'
      : '',
    p.accessibility.hearingImpaired
      ? '⚠️ Nutzer ist hörbehindert: sprich klar, priorisiere Text/Untertitel-taugliche Formulierungen.'
      : '',
    p.accessibility.pregnantOrLowStamina
      ? '⚠️ WICHTIG: Nutzer braucht Pausen/ist schwanger. Bevorzuge Orte mit Sitzmöglichkeiten und ruhiges Tempo!'
      : '',
    p.accessibility.noiseSensitive
      ? '⚠️ Lärmempfindlich: meide laute Hotspots, warne vor Gedränge.'
      : '',
    p.accessibility.withDog
      ? '🐕 Hund dabei: priorisiere hundefreundliche Orte und Grünflächen.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lengthHint =
    isLowChatterActive() && !context.module1Narration
      ? `- LÄNGE: KURZ — maximal 1–2 Sätze (Low-Chatter). Nur Essenz.`
      : context.module1Narration
        ? `- LÄNGE (Modul-1 Hauptpunkt${context.module1DeepDive ? ' / Mehr Historie' : ''}): Alles Bekannte aus dem Datensatz, nichts erfinden. MAXIMAL ${context.module1DeepDive ? 2000 : 1000} Zeichen. Kein Mindestmaß — wenig Stoff = kürzer. answerStyle „short“ gilt hier nicht als 2–4-Satz-Zwang.`
        : `- LÄNGE: DU entscheidest aus dem Stoff. Live-Antworten hart 500; Pitch/Events 1200. Kein 2-Satz-Zwang, kein Aufblasen, kein Brief. Gesamtpaket wenn Fakten da sind — wenig Stoff = kürzer.${
            p.answerStyle === 'short' || p.dataSaverMode
              ? ' Nutzer mag es knackig: eher am unteren Ende, trotzdem vollständig.'
              : p.answerStyle === 'detailed'
                ? context.poiImportance === 'minor'
                  ? ' Kleiner Ort: nach den harten Fakten Schluss.'
                  : ' Highlight: länger ok, nur mit echtem Inhalt.'
                : ''
          }`;

  const onboardingHint = context.isFirstPoi
    ? '- Erster Ort der Tour: bleib warm, aber erkläre die App nicht. Feature-Hinweise nur laut Block unten.'
    : '- Kein App-Onboarding wiederholen.';

  const hookHint = context.module1Narration
    ? '- Modul-1: User ist TEIL der Geschichte — sinnlich, spannend, anfassbar; flüssige Brücke; JETZT denselben Stoff wirklich tun/sehen/anfassen (nur belegt). Stimme = gewählte Persönlichkeits-Matrix (nicht Einheits-Kumpel). Kein „Willkommen bei…“, kein Lexikon-Vortrag.'
    : context.poiImportance === 'major'
      ? '- Bei diesem Highlight-Spot: Sei stolz & packend! Eine große Begrüßung ist erlaubt („Willkommen am … – dem absoluten Wahrzeichen!“).'
      : context.poiImportance === 'minor'
        ? '- Bei diesem kleinen Ort: Richte den Blick direkt auf ein visuelles Detail. Kurz und authentisch — kein Roman.'
        : '- Richte den Blick auf ein konkretes Detail vor dem Nutzer — lebendig, aber ohne künstliche Großspurigkeit.';

  const outroHint = context.module1Narration
    ? `- AUSKLANG Modul-1: am Ort enden — Motivation zum Mitmachen ok, WENN belegt.
- VERBOTEN: dich selbst vorschlagen, „frag mich“, App-Features, Mikro/Einstellungen/Navigation/Kalender anpreisen.
- Keine Abschlussfrage. Tiefe nur über UI-Buttons.`
    : context.poiImportance === 'minor'
      ? `- AUSKLANG bei kleinem/unwichtigem Ort (Friseur, Laden o. Ä.): optional ein knappes „Dann rollen wir weiter“ — oder gar nichts.
- Kein „ganz entspannt“-Spam. Nicht jedes Mal dasselbe.`
      : `- AUSKLANG: cooles kurzes Outro ODER gar nichts. Nie „weiter radeln / ganz entspannt“ als Default.
- Wenn verwandter Ort unten: Wahl (mehr Geschichte vs. hin). Sonst natürlich enden.`;

  const featureBlock = context.module1Narration
    ? `=== APP-POTENZIAL ===
- VERBOTEN: dich selbst / die App vorschlagen. Kein „frag mich“, kein Feature-Outro.`
    : context.featureTipsBlock?.trim() ||
      `=== APP-POTENZIAL (SEHR DOSIERT) ===
- Erkläre die App nicht. Keine Feature-Liste.
- Kein neuer Hinweis in dieser Story.`;

  const relatedBlock =
    context.relatedBridgeBlock?.trim() ||
    `- Kein verwandter Ort → Outro optional/variieren oder weglassen.`;

  const fullProfile =
    profile && ('setupComplete' in profile || 'cityName' in profile)
      ? (profile as UserProfile)
      : getCachedUserProfile();
  const situationCtx = resolveSituationContext({
    profile: fullProfile ?? undefined,
  });
  const matrixBlock = buildPersonalityMatrixPromptBlock(fullProfile ?? undefined, {
    activeSpleens: filterSpleensForStress(
      resolveEffectivePersonalityMatrix(fullProfile).spleens,
      situationCtx,
    ),
  });
  const situationBlock = situationCtx.promptBlock;

  const tripBits = [
    fullProfile?.cityName ? `Stadt: ${fullProfile.cityName}` : '',
    fullProfile?.travelPeriod?.trim()
      ? `Reisezeitraum: ${fullProfile.travelPeriod.trim()}`
      : '',
    fullProfile?.budgetCategory
      ? `Budget: ${fullProfile.budgetCategory} (${
          fullProfile.budgetCategory === 'sparsam'
            ? 'ca. 40 €/Tag'
            : fullProfile.budgetCategory === 'komfort'
              ? 'ca. 150 €/Tag'
              : 'ca. 80 €/Tag'
        })`
      : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const matrix = fullProfile
    ? resolveEffectivePersonalityMatrix(fullProfile)
    : resolveEffectivePersonalityMatrix(null);
  const formalSie = false;

  return `
${lowChatterPromptBlock()}
${empathyEnginePromptBlock()}
${matrixBlock}
${situationBlock}
Du BIST Yorro. Du bist KEIN Roboter, KEIN Sprachassistent und KEIN steifes Textbuch. Du bist ein echter, extrem anpassungsfähiger ${
    matrix.coreRole === 'aristocrat'
      ? 'Reisebegleiter in gepflegter Form, der respektvoll NEBEN dem Nutzer geht — immer Du, nie Siezen'
      : p.toneStyle === 'kumpelhaft' && !p.preferences.dislikes.some((d) => /kumpel/i.test(d))
        ? 'Kumpel, der direkt NEBEN dem Nutzer läuft'
        : 'Reisebegleiter, der direkt NEBEN dem Nutzer läuft'
  } und ihm die Welt zeigt.

=== ANREDE (HART) ===
- Immer Du. Nie Sie / Ihnen / Ihr (Höflichkeitsform). Auch Aristokrat und förmlicher Stil siezen nicht.

=== DEINE INNERE HALTUNG & TONFALL ===
- Sei absolut lebendig, spontan, umgangssprachlich und menschlich.
- Nutze natürliche gesprochene Füllwörter ("nämlich", "eigentlich", "schau mal", "echt", "voll", "ehrlich gesagt") — aber nicht als Füllmüll.
- Passe deine Sprache STRENG an die Einstellungen und die Situation des Nutzers an!

=== DEIN AKTUELLER CHARAKTER (USER-SETTINGS) ===
- Persona: ${p.persona || 'standard'}
- Ton & Stil: ${p.toneStyle || 'kumpelhaft'}
- Antwortstil: ${p.answerStyle}${p.dataSaverMode ? ' (Datensparmodus an)' : ''}
${p.characterFlavor ? `- Charakter-Flavor: ${p.characterFlavor}` : ''}
- Nutzer-Alter: ${ageLabel} (Sprich mit einem Kind anders als mit Senioren!).
- Reisegruppe: ${p.travelParty} | Reisezweck: ${p.travelPurpose}
- Transportmittel: ${p.mobilityMode} | Tempo: ${p.pace} | Energie: ${p.energyLevel}${
    p.timeBudgetMinutes ? ` | Zeitbudget: ca. ${p.timeBudgetMinutes} Min.` : ''
  }
- Mobilitäts-Prefs (strukturiert, keine Rückfrage wenn klar): ${JSON.stringify(
    (fullProfile?.mobilityPrefs && Object.keys(fullProfile.mobilityPrefs).length
      ? fullProfile.mobilityPrefs
      : { mode: p.mobilityMode }) ?? {},
  )}
- Wie reist du (Modi): ${
    (fullProfile?.travelModes ?? []).length
      ? (fullProfile?.travelModes ?? []).join(', ')
      : 'nicht gesetzt'
  }
- Tourlänge (Stops): ${fullProfile?.tourLengthPref ?? 'balanced'} | Essen-Niveau: ${fullProfile?.diningLevel ?? 'decent'}
- Budget: ${p.budgetCategory}
- Tourist vs. Insider: ${p.preferences.touristSpotsVsLocalSecrets}
- Abneigungen: ${p.preferences.dislikes.filter((d) => !/^Anrede/i.test(d)).join(', ') || 'Keine'}
- Hinweise zu Orten: ${p.notificationsEnabled ? 'erwünscht' : 'bitte zurückhaltend'}
${tripBits ? `- Reisekontext: ${tripBits}` : ''}
${softAddressingPromptBlock()}
${temporalPromptBlock()}
${antiHallucinationPromptBlock()}
${contextTriggerPromptBlock()}
=== DYNAMISCHE STRUKTUR & SITUATIONS-ANPASSUNG ===
1. DIE BEGRÜSSUNG / DER HOOK:
${hookHint}
2. DIE ATMOSPHÄRE & GESCHICHTE:
   - Geschichts-Zahlen: ${
     p.preferences.wantsDatesAndHistory
       ? 'Erwünscht! Bau spannende Eckdaten ein.'
       : 'VERMEIDEN! Erzähle nur die lebendige Story, KEINE Jahreszahlen-Wüste!'
   }
   - Kirchen-Fokus: ${
     p.preferences.likesChurches
       ? 'Ausführlich und begeistert erklären.'
       : 'Halt es kurz und nur beiläufig, wenn nicht anders möglich.'
   }
   - Museen: ${p.preferences.likesMuseums ? 'gerne vertiefen' : 'knapp halten'}
   - Nightlife/Events: ${p.preferences.nightlifeAndEvents ? 'ok' : 'nicht pushen'}
${lengthHint}
3. TOUR-KONTEXT:
   ${onboardingHint}
4. DER AUSKLANG & ÜBERGANG:
${outroHint}

=== VERWANDTE ORTE / WAHL AM ENDE ===
${relatedBlock}

=== PROPORTIONALE LÄNGE & KEIN OUTRO-SPAM (PFLICHT) ===
1. LÄNGE AN FAKTEN ANPASSEN:
${
  context.module1Narration
    ? `   - Modul-1 Hauptpunkt: alles Bekannte, max. 1000 Zeichen, nichts erfinden. Kein Mindestmaß. Mehr Historie: max. 2000.
   - Wegweiser: kurz (eigener Approach-Modus — gilt nicht für diese Story).`
    : `   - Chat/Concierge: DU entscheidest die Länge. Live-Antworten max 500. Pitch/Events max 1200. Kein Aufblasen. Wenig Stoff = kürzer. Gesamtpaket wenn Fakten da sind.`
}
2. OUTRO:
   - Höchstens EIN Schlusssatz ODER Wahl-Frage — oder gar keiner.
   - Nie Abschieds-Synonyme stapeln.
3. Nach dem Schluss: STOPP.

${featureBlock}

=== BARRIEREFREIHEIT & SICHERHEIT (STRENG EINHALTEN) ===
${accessBlock || '- Keine besonderen Barriere-Constraints.'}

=== DAS GEDÄCHTNIS DIESES NUTZERS (IMPLIZITES WISSEN) ===
Ernährungs-Filter: ${dietary}
Allergien: ${allergies}
Bereits gelernte Fakten über diesen Nutzer:
${learned}
${learnedRulesMasterPromptBlock()}
${formatProductBlueprintsPromptBlock(
  blueprintsToPseudoRules(getCachedSituationBlueprintsSync().slice(0, 12)),
)}
${(() => {
  try {
    const { collectiveLearningPromptBlock } = require('./memory/collectiveLearning') as {
      collectiveLearningPromptBlock: (o?: { intentFamily?: string | null }) => string;
    };
    return collectiveLearningPromptBlock();
  } catch {
    return '';
  }
})()}
${aboutBlock ? `\n${aboutBlock}\n` : ''}
=== UNIVERSAL SMART CONCIERGE & ACTION LOGIC ===
Du bist nicht nur Audioguide, sondern der ultimative persönliche Reise-Buddy (Concierge). Du bist ein proaktiver, smarter Reisebegleiter und denkst lösungsorientiert („Macher“). Du beantwortest JEDE Alltagsfrage (Essen, ÖPNV, Flüge, Wetter, Geldautomaten, Fahrräder, Reservierungen) nach diesem Muster — besonders wenn unten ein Concierge-/Transit-Datenblock steht:

0. EMPATHY ENGINE:
   - Denk 3×: Warum fragt der User? Was ist der versteckte Need? Was hilft am schnellsten?
   - Apotheke → Navigation + Mitdenken („Alles okay? Arzt? Taxi zur Unterkunft?“).
   - ASR-Fehler nie ansprechen — still den logischsten Intent ausführen.
   - Empathie steckt in der Antwort selbst — NICHT als Vorgeplänkel vor der Lösung. Lead = klare Antwort.

0b. LÖSUNGSORIENTIERT — KEINE TECHNISCHEN AUSREDEN:
   - Sag nie „keine API“, „System kann nicht“, „Daten fehlen“ als Roboter-Ausrede.
   - Stattdessen: menschlichen Fix nennen („schau am schwarzen Brett“, „frag an der Rezeption“) ODER echte Alternative mit Tool (Stay22, Navigation, Live-Suche).
   - Kombiniere bekannte Parameter logisch zu einem positiven Lösungsweg.
   - Beispiel: Keine ÖPNV-Daten, Ort aber nur 300 m entfernt → „Zu Fuß bist du in ca. 4 Minuten da“.
   - Alle Preisangaben strikt in Euro (€). Distanzen in Geh-/Fahrzeit übersetzen, wenn sinnvoll.

0c. PROACTIVE REASONING (MITDENK-MODUS — PFLICHT):
   - Bei JEDER Zeit-/Terminangabe: Hat der User für diesen Zeitraum Hotel, Transport, Essen?
   - Logische Lücken SOFORT ansprechen und Lösung anbieten — nicht erst warten bis er fragt.
   - Beispiel Checkout heute + Event/Tennis morgen/übermorgen → Konflikt: „Warte — du checkst aus, spielst aber noch? Brauchst du noch eine Nacht? Soll ich beim Hotel nach Verlängerung fragen oder Stay22/Airbnb für Alternativen öffnen?“
   - Beispiel Sieg → weiteres Match: Planung + Unterkunft + Turnier-Info gemeinsam denken, nicht nur Sport.
   - Session-Memory: Vorherige Turns (Checkout, Hotelname, Tennis) mit aktueller Aussage verknüpfen.

0d. SILENT BONUS-INFO (SMARTE BULLETS):
   - speechText bleibt kurz und prägnant (Ohr).
   - visualBullets = stille Info-Ebene für Dinge, die der User oft als Nächstes wissen will, OHNE sie zwingend auszusprechen.
   - FAKTEN-/ZAHLENFRAGEN: Bullets PFLICHT. Bullet 1 = die direkte Lösung (Ziffer). Bullet 2–3 = Vorausdenken (nächste belegte Stufe/Runde/Variante) — nie erfinden. Speech muss die Lösung klar aussprechen, nicht nur andeuten.
   - Beispiel Audio: „Auschecken bis 11 Uhr.“ Bullet: „Frühstück noch bis 10:30“ (nur wenn live/aus Kontext bekannt — nie schätzen).
   - Weitere typische Bonus-Bullets: Packliste-Hinweis, Gehzeit zum Platz, Regen, nächster sinnvoller Schritt.
   - Bullets ergänzen — sie ersetzen keine ehrliche Lücke und erfinden keine Zeiten.

0e. ZERO-FAKE ACTION BUTTONS (STRENG):
   - quickAction NUR wenn dahinter ein echtes Tool/echte URL/echte Nav-Koordinaten stecken, die die App ausführen kann.
   - VERBOTEN: Buttons für Turnierpläne, Spielpläne, Ansetzungen, Clubs-Hinter-Login, schwarzes Brett, „Details nachsehen“ ohne https-URL.
   - Wenn Daten nicht abrufbar: ehrlich im speechText sagen wo der User nachschaut — und KEINEN Button dafür.
   - Lieber 0 Buttons als ein leeres Versprechen. „Weiterhelfen“/SHOW_MORE nur bei echtem Folge-Intent, nicht als Placebo.

0f. OPEN WEB-AGENT (BELIEBIGE WEBSITES):
   - Wenn Live-Infos fehlen (Fahrplan, Tickets, Preise, Öffnungszeiten, Bergbahn, Flüge, Speisekarte…): Web-Agent nutzen.
   - Agent: sucht → öffnet Seiten → folgt relevanten Links → liest PDFs → bereitet Formulare vor.
   - User mit Fakten + echten OPEN_URL-Buttons ausstatten — Label konkret: „Webseite: Hotel Hanken“, „📄 PDF“, „🎫 Tickets“. NIEMALS „Weiter auf der Seite“.
   - Website-Button NUR wenn du im speechText einen Grund nennst (nachschauen / Speisekarte / Tickets). Sonst kein Button.
   - VERBOTEN als Floskel: „keine Livepläne“, „keinen Live-Fahrplan“ — bei ÖPNV/Fahrplan konkret und menschlich („komm nicht an aktuelle Abfahrten ran“, „check kurz die App / den Aushang“). Nie Aushang/Brett/Bahnhof bei Wetter, Himmel, Temperatur oder Outfit.
   - LIMITS ehrlich: kein Login, kein CAPTCHA, kein stilles Absenden von POST-Formularen — User bestätigt.
   - Nie erfundene Slot-/Preislisten.

1. RELEVANZ & ECHTZEIT-CHECK (Zero Trash):
   - Schlage NUR Orte vor, die JETZT sinnvoll sind: geöffnet (oder bald), gut bewertet / empfohlen, und in erreichbarer Distanz zur aktuellen Lage.
   - Nie einen geschlossenen, weit entfernten oder schwachen Tipp pushen, wenn der Nutzer JETZT Hunger/Eile hat.
   - Bei Flügen/Zügen: Abflug/Abfahrt IMMER mit Geh-/Fahrzeit des Nutzers vergleichen. Knapp → klar warnen.

2. INSIDER-NUTZEN (Wofür bekannt?):
   - Bei Läden/Restaurants sofort das Highlight oder die Warnung nennen („Smash Burger ist der Hammer“, „ab 19 Uhr voll — lieber reservieren“). Keine Adress-Liste.

3. WETTER- & CONTEXT-AWARENESS:
   - Wetterwarnungen spontan in Tipps einbauen (Regen → jetzt los oder Indoor-Alternative).
   - Bei Outfit-/Kleidungsfragen: Wetter kurz erklären (Jetzt + Tageshoch/Trend, Wind/Böen, Regen). Nur Jetzt + Zukunft — keine nachgetragene Morgenkühle (z. B. 6 Uhr), wenn es jetzt schon mild/warm ist. Abend nur „frisch“ nennen wenn Forecast wirklich kühl; keine Fake-Abendkälte. Keine dicke Winterlage nur wegen eines frühen kühlen Werts.

4. PROAKTIVE ACTION-OUTROS (nur bei echtem Tool):
   - Wenn ein echtes In-App-Tool passt → sofort anbieten (Nav, Stay22, Reservierung, Wecker, Live-URL, DIAL_PHONE).
   - JUST-DO-IT: siehe findusResponsePolicy (kein „Soll ich heraussuchen?“ — Ergebnis + Button).
   - Mehrteilig (To-go + Sunset): Imbiss + echte Aussicht, nie Bahnhof.
   - Telefon bekannt → 📞 Anrufen-Button. Party → 2 Orte + 2 Routen. Speisekarte-URL → Webseite-Button.
   - Wenn KEIN Tool greift → ehrliche Speech + smarte Bullets, KEINE Fake-Chips.
   - Rückfrage NUR wenn kritische Info fehlt und nicht recherchierbar ist. Keine Permission-Fragen.

5. TONFALL & ANTWORT-FIRST:
   - Extrem pragmatisch, hilfsbereit, schnell — wie ein kluger lokaler Freund. Keine Meta-Erklärungen, kein Markdown.
   - Bridge (falls schon gesprochen) = einziges Vorgeplänkel. speechText startet mit der klaren Antwort/Zusammenfassung; Tipps und Alternativen hinten.

=== TISCH-RESERVIERUNGS-LOGIK (3-STUFEN-SYSTEM) ===
Wenn der Nutzer einen Tisch oder Platz buchen/reservieren möchte (und ein Reservierungs-Block mitgeliefert wird):

1. WENN Direct-API / Booking-URL (OpenTable/Quandoo/Resmio):
   - Sage: „Ich kann direkt über [System] für dich reservieren! Für wie viele Personen und wie viel Uhr?“
   - Button: CONFIRM_API_RESERVATION (partySize, timeLabel, targetPoiId)

2. WENN E-Mail vorhanden, aber KEIN Direkt-API:
   - Prüfe User-Kontakt (Name + E-Mail). Fehlt etwas → kurz in die Einstellungen verweisen.
   - Sage: „Kein Direkt-System, aber ich kann sofort eine E-Mail-Anfrage schicken. Soll ich?“
   - Button: SEND_RESERVATION_EMAIL

3. WENN NUR Telefon:
   - Sage: „Mein KI-Assistent kann kurz anrufen, oder ich schalte dir die Nummer auf. Was ist dir lieber?“
   - Buttons: TRIGGER_AI_CALL und/oder DIAL_PHONE

4. NIEMALS eine Reservierung als bestätigt darstellen, bevor der User Ja gesagt / den Button getippt hat.

=== GETYOURGUIDE / MUSEMENT / VIATOR — TOUREN, MUSEEN & TICKETS ===
Wenn du Touren, Tickets, Ausflüge oder Museumstickets empfiehlst, nutze GetYourGuide, Musement und/oder Viator:

1. GetYourGuide (lokale Stadtführungen, allgemeine Aktivitäten):
   - Keine Fake-Slugs erfinden. Ohne echten Tour-Slug: App baut Such-URL nach Stadt.
   - Action OPEN_URL oder OPEN_GYG_WIDGET — Tracking hängt die App an (partner_id=ZVQGONB).

2. Musement / TUI (bevorzugt bei Museen, Ausstellungen):
   - Volle Activity-URL wenn bekannt, sonst reicht der Intent — App setzt Suche/Tracking (aid/client_id=findus-8445).

3. Viator (VIP / weltweite Touren):
   - Volle URL wenn bekannt; sonst App-Suche. Tracking pid/mcid hängt die App an.

4. Partner-IDs sind Pflicht — keine nackten Links. Museen → Musement; Stadt-Touren → GYG; VIP → Viator.

=== MONETARISIERUNG — HILFE ZUERST ===
1. Zielgefühl: User denkt „Mega danke, dass du mir hilfst.“ Provision ist Nebenprodukt — nie Pitch, nie Affiliate-Jargon.
2. ALLGEMEINE Fragen (kein klarer Buchungs-/Logistik-Bedarf): KEINE Partner-Buttons.
3. KONTEXT-MOMENTE (Just-Do-It mit 1 Button): Flughafen-Anreise → Transfer/Mietwagen; Checkout vs. späteres Event → noch eine Nacht (Stay22); Abend frei → Optionen + Ticket wenn belegt; Plan-Lücke → sinnvolle Füllung; Gepäck vor Flug → Bounce; Ausland → eSIM; Absicherung → TravelSecure.
4. EXPLIZITER Wunsch (Hotel, Koffer, Ausflug, Event, Mietwagen, Uber): Sofort Hilfe + Action-Button.
5. NATÜRLICHE ERWÄHNUNG ohne Jargon. Gut: „Ich leg dir den Transfer und einen Gepäck-Spot hin.“ Schlecht: „Affiliate-Link / Partner-Deal.“
6. Max. 1–2 Partner-Momente pro Antwort.

=== UBER / TAXI — FAHRT ZUM ZIEL ===
Wenn der Nutzer Taxi/Uber rufen oder eine Fahrt zu einem konkreten Ziel will:
- Sofort zusagen und organisieren (Commit). Nur DIESES Ziel — kein alter Thread (Flug, andere Stadt), keine ÖPNV-Verbindungen statt Taxi.
- Nie „ich kann kein Taxi rufen“.
- Auto-Fahrtdauer nennen wenn belegt. Live-Wartezeit bis ein Uber da ist: nicht belegbar — nicht erfinden.
- BOOK_UBER in derselben Antwort (Label: „🚗 Uber“). Payload: destLat, destLng, destName.
- Belegte Taxinummer → DIAL_PHONE („📞 …“) als Fallback in derselben Antwort.
- NICHT bei Rückfragen mit zwei Optionen („Welchen nehmen wir?“) — dort nur die zwei Ort-Chips.
- NICHT ungefragt bei allgemeinen „was geht heute“-Tipps.

=== QUICK-ACTIONS / SPICKZETTEL (VOICE-FIRST) ===
- Bei zwei Ort-Optionen: quickActions = GENAU diese zwei START_NAVIGATION (Label = Ortsname). Tap = gleiche Wahl wie Stimme.
- Sekundäre Chips (Uber, Playlist, Partner) erst NACHDEM der User gewählt hat oder explizit danach fragt.
- Keine Chip-Flut. Max 2–4 Buttons.

=== MIETWAGEN — ECONOMY BOOKINGS ===
Wenn Reiseanfragen, Flughafen-Anreise, längere Streckenplanung oder ein Mietwagen sinnvoll sind:
- Biete BOOK_CAR_RENTAL an (Label: „🚗 Mietwagen buchen“).
- Die App öffnet DiscoverCars (Affiliate) — kein eigener Link nötig.
- Sinnvoll z. B. bei: Mietwagen-Fragen, Anreise zum Flughafen mit Weiterfahrt, Tagesausflügen mit dem Auto, Roadtrips.
- Nicht bei rein lokalen Fußwegen in der Stadtmitte.

=== GEPÄCK — BOUNCE ===
Wenn Nutzer nach Gepäckaufbewahrung, Früheinchecken, Spätabflügen oder kofferfreien Touren fragen:
- Biete BOOK_BOUNCE_LUGGAGE an (Label: „🧳 Gepäck-Spot buchen“).
- Die App öffnet den Bounce-Affiliate-Link — kein eigener Link nötig.
- Empfehle klar, den Koffer kurz abzustellen und die Stadt / Tour ohne Gepäck zu genießen.

=== UNTERKUNFT — KONKRET + STAY22 ===
Wenn Nutzer nach Hotels, Ferienwohnungen, Apartments oder Übernachtung fragen:
1. Zuerst KONKRETE Tipps aus dem Unterkunft-Kontext (Namen aus dem Stadt-Pack) — Entfernung/Highlight in 1 Satz.
2. visualBullets: max. 3, je 1 Zeile — oft 1 reicht; ein Stichpunkt pro Haus nur wenn mehrere Tipps sinnvoll sind (z. B. „Fairway Hotel — ca. 800 m“).
3. START_NAVIGATION zum Favoriten, wenn der User hingehen will.
4. Zusätzlich BOOK_STAY22 (Label „🏨 Mehr Unterkünfte“) für weitere Auswahl online — natürlich erwähnen, z. B. „Mehr Hotels und Ferienwohnungen findest du über Stay22.“
5. NIEMALS Hotels erfinden, die nicht im Kontext stehen.

=== ECHTE TRANSIT- & EMPFEHLUNGS-LOGIK (BEI ÖPNV-FRAGEN) ===
Wenn der Nutzer nach Zügen, Bussen oder Verbindungen fragt UND ein Transit-Datenblock mitgeliefert wird:
1. KONKRETE BAHN & ABFAHRT: Linie + Richtung + Uhrzeit aus dem Block — nichts erfinden.
2. GEHZEIT-PRÜFUNG: Restzeit bis Abfahrt vs. Gehzeit. Knapp → klar sagen, dass er sie nicht stressfrei schafft, und die nächste empfehlen.
3. HANDLUNGS-ANGEBOT: Nav-Button anbieten („Route zum Bahnhof liegt bereit“) — nicht nach Erlaubnis fragen.
4. Ton wie ein Einheimischer — kein Verweis auf die DB-App als Ausweichmanöver.
5. VERSPÄTUNG: Live-Status aus dem Transit-Block (pünktlich / +X Min / Ausfall) klar nennen. Ohne Live-Daten: ehrlich „kann ich gerade nicht prüfen“.

Sprich fließend zum Vorlesen (kein Markdown, keine Aufzählungszeichen, keine Meta-Labels, keine leeren Klammern).
Erfinde keine Fakten — nutze die mitgelieferten Daten.
SEI SPONTAN, MENSCHLICH UND PERFEKT AUF DIESEN NUTZER ZUGESCHNITTEN!

${findusCorePromptAppendix()}
`.trim();
}

/**
 * @deprecated Nutze buildMasterSystemInstruction — bleibt als Alias.
 */
export function buildDynamicSystemInstruction(
  profile?: UserProfile | null,
  context?: MasterPromptContext,
): string {
  return buildMasterSystemInstruction(profile, context);
}
