/**
 * Turn-Rucksack v1 — Phase 0 Kontext für Call 1 + Call 2 (RFC).
 */

import { readRucksackSync, anchorCoords } from '../../rucksack/rucksackStore';
import { resolveCityChatScope } from '../../context/placeContext';
import { getCachedUserProfile } from '../../../services/userProfileService';
import {
  resolveEffectivePersonalityMatrix,
} from '../../../services/persona/personalityMatrixPrompt';
import { CORE_ROLES } from '../../../constants/personalityMatrix';
import { getLearnedRules } from '../../../services/memory/correctionLearning';
import { getShortTerm } from '../../context/shortTermContext';
import type { BulletUiBudget } from './bulletUiBudget';
import { BULLET_SURFACE_MAX_CHARS } from '../../../services/concierge/visualBullets';

export type TurnRucksackV1 = {
  turnId: string;
  gps: {
    lat: number | null;
    lng: number | null;
    cityLabel: string | null;
    speedKmh: number | null;
    accuracyM: number | null;
  };
  selectedCityId: string | null;
  researchCity: string | null;
  packInstalled: {
    forResearchCity: boolean;
    catalogHasPack: boolean;
    cityId: string | null;
  };
  persona: {
    coreRole: string;
    vibeTone: string;
    knowledgeStyle: string;
    spleens: string[];
    addressForm: 'du' | 'sie';
    bridgeToneHint: string;
  };
  ui: {
    bulletMaxChars: number;
    bulletLines: 2;
    bulletCount: 3;
    measuredAt?: string;
    screenWidthPx?: number;
  };
  sessionFlags: {
    navActive: boolean;
    calendarOpen: boolean;
    liveChatActive: boolean;
    planModuleActive: boolean;
  };
  shortIntent?: {
    lastJobId: string | null;
    lastSubject: string | null;
    lastPlace: string | null;
    liveInventoryKind: string | null;
  };
  learnedRules?: Array<{ intentFamily: string; summary: string }>;
  ownerGoldHint?: string | null;
  retrievedMemory?: string[];
};

function bridgeToneFromRole(coreRole: string): string {
  const role = CORE_ROLES.find((r) => r.id === coreRole);
  if (!role) return 'warm, klar, kurz';
  if (coreRole === 'classic_guide') {
    return 'Classic Guide: professionell sympathisch, unkompliziert — umgangssprachlich, locker flockig, Verlässlicher Begleiter';
  }
  if (coreRole === 'historian') return 'Opa-Historiker: warm, bildhaft, kurz';
  if (coreRole === 'aristocrat') return 'gepflegt, respektvoll, knapp';
  if (coreRole === 'buddy') return 'locker, auf Augenhöhe, zackig';
  return `${role.labelDe}: ${role.infoDe}`.slice(0, 120);
}

function resolveResearchCity(userText?: string | null): string | null {
  try {
    const scope = resolveCityChatScope(userText);
    return scope.cityHint || null;
  } catch {
    return null;
  }
}

function slugCityId(label: string | null): string | null {
  if (!label) return null;
  return label
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function buildTurnRucksack(opts: {
  turnId: string;
  userText?: string | null;
  bulletBudget?: BulletUiBudget | null;
  navActive?: boolean;
  calendarOpen?: boolean;
  liveChatActive?: boolean;
  planModuleActive?: boolean;
}): TurnRucksackV1 {
  const bag = readRucksackSync();
  const coords = anchorCoords(bag);
  const speedKmh =
    bag.vector.speedMps != null
      ? Math.round(bag.vector.speedMps * 3.6 * 10) / 10
      : null;
  const researchCity = resolveResearchCity(opts.userText);
  const researchCityId = slugCityId(researchCity);
  const profile = getCachedUserProfile();
  const matrix = resolveEffectivePersonalityMatrix(profile);
  const short = getShortTerm();

  let selectedCityId: string | null = null;
  let packForResearch = false;
  let catalogHas = false;
  try {
    const { useFinnusStore } = require('../../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { cityId?: string | null };
      };
    };
    selectedCityId = useFinnusStore.getState().cityId ?? null;
  } catch {
    selectedCityId = null;
  }
  if (researchCityId && selectedCityId) {
    packForResearch =
      researchCityId === String(selectedCityId).trim().toLowerCase();
  }
  try {
    const { peekWarmCityCatalog } = require('../../../services/cityCatalogService') as {
      peekWarmCityCatalog: () => Array<{ id: string }> | null;
    };
    const cat = peekWarmCityCatalog();
    if (cat && researchCityId) {
      catalogHas = cat.some(
        (c) => c.id.toLowerCase() === researchCityId.toLowerCase(),
      );
    }
  } catch {
    catalogHas = false;
  }

  const bulletMaxChars =
    opts.bulletBudget?.bulletMaxChars ??
    BULLET_SURFACE_MAX_CHARS.default;

  let ownerGoldHint: string | null = null;
  try {
    const { getOwnerGoldBlueprints } = require('../../blueprints/ownerGold') as {
      getOwnerGoldBlueprints: () => Array<{ summary?: string }>;
    };
    const gold = getOwnerGoldBlueprints();
    ownerGoldHint = gold[0]?.summary?.slice(0, 200) ?? null;
  } catch {
    ownerGoldHint = null;
  }

  const rules = getLearnedRules()
    .slice(0, 4)
    .map((r) => ({
      intentFamily: String(r.intentFamily || 'general'),
      summary: String(r.summary || '').slice(0, 120),
    }))
    .filter((r) => r.summary);

  return {
    turnId: opts.turnId,
    gps: {
      lat: coords.lat,
      lng: coords.lng,
      cityLabel: bag.cityHint,
      speedKmh,
      accuracyM: bag.gpsHistory.at(-1)?.accuracyM ?? null,
    },
    selectedCityId,
    researchCity,
    packInstalled: {
      forResearchCity: packForResearch,
      catalogHasPack: catalogHas,
      cityId: researchCityId,
    },
    persona: {
      coreRole: matrix.coreRole,
      vibeTone: matrix.vibeTone,
      knowledgeStyle: matrix.knowledgeStyle,
      spleens: [...matrix.spleens],
      addressForm: 'du' as const,
      bridgeToneHint: bridgeToneFromRole(matrix.coreRole),
    },
    ui: {
      bulletMaxChars,
      bulletLines: 2,
      bulletCount: 3,
      measuredAt: opts.bulletBudget?.measuredAt,
      screenWidthPx: opts.bulletBudget?.screenWidthPx,
    },
    sessionFlags: {
      navActive: Boolean(opts.navActive),
      calendarOpen: Boolean(opts.calendarOpen),
      liveChatActive: Boolean(opts.liveChatActive),
      planModuleActive: Boolean(opts.planModuleActive),
    },
    shortIntent: {
      lastJobId: null,
      lastSubject: short.lastTopic ?? null,
      lastPlace: short.lastPlaceName ?? null,
      liveInventoryKind: null,
    },
    learnedRules: rules.length ? rules : undefined,
    ownerGoldHint,
  };
}

export function formatRucksackLine(r: TurnRucksackV1): string {
  return `RUCKSACK: ${JSON.stringify(r)}`;
}

/** LTM v1 — keyword retrieval wenn Call-1 memoryPolicy.longTerm. */
export async function enrichTurnRucksackWithLtm(
  rucksack: TurnRucksackV1,
  opts: {
    userText: string;
    memoryPolicy?: { longTerm?: boolean } | null;
    cityKey?: string | null;
  },
): Promise<TurnRucksackV1> {
  if (!opts.memoryPolicy?.longTerm) return rucksack;
  try {
    const { searchUserMemoryFacts, formatUserMemoryForPrompt } = await import(
      '../../../db/userMemoryFacts'
    );
    const facts = await searchUserMemoryFacts({
      subject: opts.cityKey || rucksack.researchCity,
      query: opts.userText,
      limit: 6,
    });
    if (!facts.length) return rucksack;
    const lines = formatUserMemoryForPrompt(facts)
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())
      .slice(0, 6);
    return { ...rucksack, retrievedMemory: lines };
  } catch {
    return rucksack;
  }
}
