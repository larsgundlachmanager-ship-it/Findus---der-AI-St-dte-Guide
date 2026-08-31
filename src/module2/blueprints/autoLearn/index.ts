/**
 * Auto-Learning Blaupausen — Signal → Cluster → Gate → Auto-Patch (kein Human-Review).
 * AsyncStorage lazy — Node-Smoke ohne RN.
 */

import type { PersonaVariant } from '../../router/routeAllowlist';

const STORAGE_KEY = 'findus.blueprint.autolearn.v1';
const THRESHOLD = 2;

export type LearnSignal = {
  id: string;
  atMs: number;
  blueprintId: string;
  personaVariant: PersonaVariant;
  missingSlot: string;
  userSnippet: string;
  cityHint?: string | null;
};

export type LearnedSlot = {
  slot: string;
  brief: string;
  count: number;
  personaVariant: PersonaVariant;
  updatedAtMs: number;
};

export type AutoLearnState = {
  signals: LearnSignal[];
  learnedSlots: LearnedSlot[];
};

let mem: AutoLearnState = { signals: [], learnedSlots: [] };
let hydrated = false;

async function getStorage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as AutoLearnState;
    if (p && Array.isArray(p.signals) && Array.isArray(p.learnedSlots)) {
      mem = p;
    }
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mem));
  } catch {
    /* soft */
  }
}

function normalizeSlot(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_]+/giu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Heuristik: Follow-up nach Kino/Theater/Gastro oft fehlende Slots. */
export function detectMissingSlotFromFollowUp(userText: string): string | null {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (/\bpopcorn\b/iu.test(t) && /\b(preis|teuer|kostet|wie\s+viel)\b/iu.test(t)) {
    return 'popcorn_price';
  }
  if (/\b(sitzerhöhung|sitzerhoehung|kinderwagen|wickel)\b/iu.test(t)) {
    return 'family_amenities';
  }
  if (/\b(bier|getränk|getraenk|bar)\b/iu.test(t)) {
    return 'drinks_on_site';
  }
  if (
    /\b(wie\s+weit|distanz|entfernung).{0,40}\b(bühne|buehne|leinwand|screen)\b/iu.test(
      t,
    ) ||
    /\b(bühne|buehne).{0,20}(weit|nah)\b/iu.test(t)
  ) {
    return 'seat_distance_stage';
  }
  if (/\b(eintritt|ticketpreis|wie\s+teuer|kostet\s+das)\b/iu.test(t)) {
    return 'ticket_price';
  }
  if (/\b(öffnungs|oeffnungs|wann\s+auf|geöffnet|geoeffnet|bis\s+wann)\b/iu.test(t)) {
    return 'opening_hours';
  }
  if (/\b(speisekarte|menü|menu|karte)\b/iu.test(t)) {
    return 'menu_url';
  }
  if (/\b(buch|reserv|ticket\s*link|wo\s+buch)\b/iu.test(t)) {
    return 'booking_url';
  }
  if (
    /\b(wie\s+(?:komme|komm)\s+ich\s+(?:da\s+)?(?:rauf|hinauf|hoch)|talstation|bergstation|auffahrt)\b/iu.test(
      t,
    )
  ) {
    return 'booking_url';
  }
  if (
    /\b(und\s+(?:wie|was|ob)|kannst\s+du\s+(?:mir\s+)?noch|vergessen|fehlt)\b/iu.test(
      t,
    )
  ) {
    const m = t.match(/\b([a-záäöüß]{4,40})\??$/iu);
    if (m) return normalizeSlot(`followup_${m[1]}`);
  }
  return null;
}

export function machineGateSlot(slot: string, brief: string): boolean {
  if (!slot || slot.length < 4) return false;
  if (!brief || brief.trim().length < 12) return false;
  if (/^(sag genau|du musst sagen|wortlaut:)/i.test(brief)) return false;
  if (/\b(affiliate|provision|partnerzwang)\b/i.test(brief)) return false;
  if (brief.length > 280) return false;
  return true;
}

function briefForSlot(slot: string): string {
  switch (slot) {
    case 'popcorn_price':
      return 'Popcorn-/Snack-Preise recherchieren und nur nennen wenn belegt.';
    case 'family_amenities':
      return 'Familien-Ausstattung (Sitzerhöhung, Kinderwagen, Wickeln) wenn belegt.';
    case 'drinks_on_site':
      return 'Getränke/Bier vor Ort nur mit Beleg nennen.';
    case 'seat_distance_stage':
      return 'Distanz Sitzplatz zur Bühne/Leinwand wenn belegt.';
    case 'ticket_price':
      return 'Eintritts-/Ticketpreise nur mit Beleg.';
    case 'opening_hours':
      return 'Öffnungszeiten live prüfen und nur nennen wenn belegt.';
    case 'menu_url':
      return 'Speisekarte/Menü-URL suchen und Button anbieten wenn belegt.';
    case 'booking_url':
      return 'Buchungs-/Ticket-Link suchen und Button anbieten wenn belegt.';
    default:
      return `Zusatzfakt „${slot}“ recherchieren und nur nennen wenn belegt.`;
  }
}

export async function recordLearnSignal(opts: {
  blueprintId: string;
  personaVariant: PersonaVariant;
  userText: string;
  cityHint?: string | null;
  missingSlot?: string | null;
}): Promise<LearnedSlot | null> {
  await hydrate();
  const slot =
    opts.missingSlot || detectMissingSlotFromFollowUp(opts.userText);
  if (!slot || !opts.blueprintId) return null;

  const brief = briefForSlot(slot);
  if (!machineGateSlot(slot, brief)) return null;

  const sig: LearnSignal = {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    atMs: Date.now(),
    blueprintId: opts.blueprintId,
    personaVariant: opts.personaVariant,
    missingSlot: slot,
    userSnippet: opts.userText.slice(0, 120),
    cityHint: opts.cityHint ?? null,
  };
  mem.signals = [...mem.signals.slice(-200), sig];

  const same = mem.signals.filter(
    (s) =>
      s.blueprintId === opts.blueprintId &&
      s.missingSlot === slot &&
      s.personaVariant === opts.personaVariant,
  );

  if (same.length < THRESHOLD) {
    await persist();
    return null;
  }

  const existing = mem.learnedSlots.find(
    (l) =>
      l.slot === slot &&
      l.personaVariant === opts.personaVariant &&
      l.brief.includes(`[${opts.blueprintId}]`),
  );

  const learned: LearnedSlot = {
    slot,
    brief: `[${opts.blueprintId}] ${brief}`,
    count: same.length,
    personaVariant: opts.personaVariant,
    updatedAtMs: Date.now(),
  };

  if (existing) {
    mem.learnedSlots = mem.learnedSlots.map((l) =>
      l === existing ? { ...learned, count: Math.max(l.count, same.length) } : l,
    );
  } else {
    mem.learnedSlots = [...mem.learnedSlots, learned].slice(-80);
  }

  await persist();
  try {
    // Crowd: derselbe Slot → Collective Learning (proaktiv für alle)
    const { contributeFollowUpSignal } = require('../../../services/memory/collectiveLearning') as {
      contributeFollowUpSignal: (o: {
        intentFamily: string;
        slot:
          | 'times_hours'
          | 'prices'
          | 'menu'
          | 'booking_url'
          | 'tickets'
          | 'route_button'
          | 'website'
          | 'alternatives'
          | 'duration';
        topic?: string | null;
        userText?: string;
      }) => Promise<void>;
    };
    const slotMap: Record<string, 'times_hours' | 'prices' | 'menu' | 'booking_url' | 'tickets' | 'duration'> = {
      ticket_price: 'prices',
      popcorn_price: 'prices',
      opening_hours: 'times_hours',
      menu_url: 'menu',
      booking_url: 'booking_url',
    };
    const mapped = slotMap[slot] || 'tickets';
    const family =
      opts.blueprintId === 'theater' || opts.blueprintId === 'cinema'
        ? 'events'
        : opts.blueprintId || 'chat';
    void contributeFollowUpSignal({
      intentFamily: family,
      slot: mapped,
      topic: slot,
      userText: opts.userText,
    });
  } catch {
    /* soft */
  }
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(
        '[autoLearn] published slot',
        opts.blueprintId,
        slot,
        opts.personaVariant,
        same.length,
      );
    }
  } catch {
    /* soft */
  }
  return learned;
}

export async function getLearnedFactBriefs(opts: {
  blueprintId: string | null;
  personaVariant: PersonaVariant;
}): Promise<string[]> {
  await hydrate();
  if (!opts.blueprintId) return [];
  const ids =
    opts.blueprintId === 'theater' || opts.blueprintId === 'cinema'
      ? ['cinema', 'theater']
      : [opts.blueprintId];
  return mem.learnedSlots
    .filter(
      (l) =>
        ids.some((id) => l.brief.includes(`[${id}]`)) &&
        (l.personaVariant === opts.personaVariant ||
          l.personaVariant === 'default'),
    )
    .map((l) => l.brief)
    .slice(0, 12);
}

/**
 * Sync gelernte Slots → Collective Learning (Supabase), sofern Credentials da.
 * Kein Human-Review — Machine-Gate bereits in recordLearnSignal.
 */
export async function publishLearnedBlueprintsRemote(): Promise<void> {
  await hydrate();
  if (!mem.learnedSlots.length) return;
  try {
    const { contributeFollowUpSignal } = require('../../../services/memory/collectiveLearning') as {
      contributeFollowUpSignal: (o: {
        intentFamily: string;
        slot: 'prices' | 'menu' | 'booking_url' | 'tickets' | 'times_hours';
        topic?: string | null;
      }) => Promise<void>;
    };
    for (const l of mem.learnedSlots.slice(-20)) {
      const bp = l.brief.match(/^\[([^\]]+)\]/)?.[1] || 'chat';
      void contributeFollowUpSignal({
        intentFamily: bp,
        slot:
          l.slot === 'opening_hours'
            ? 'times_hours'
            : l.slot === 'menu_url'
              ? 'menu'
              : l.slot === 'booking_url'
                ? 'booking_url'
                : 'prices',
        topic: l.slot,
      });
    }
  } catch {
    /* soft */
  }
}

/** Test helper */
export function _resetAutoLearnMemoryForTests(): void {
  mem = { signals: [], learnedSlots: [] };
  hydrated = true;
}
