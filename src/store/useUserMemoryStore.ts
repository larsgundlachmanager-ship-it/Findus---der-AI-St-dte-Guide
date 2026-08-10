/**
 * Persistentes User-Memory: Hotels, Restaurants, Stops — implizit gelernt.
 * Speicherung: FileSystem JSON (wie UserProfile).
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';

export type UserEntityType =
  | 'hotel'
  | 'restaurant'
  | 'attraction'
  | 'transit'
  | 'custom';

export type UserEntity = {
  id: string;
  type: UserEntityType;
  name: string;
  /** true = User bestätigt / klar genannt; false = Kandidat */
  isConfirmed: boolean;
  lat?: number;
  lng?: number;
  visitedAt?: string;
  dwellTimeMinutes?: number;
  notes?: string;
  /** Optionaler Link zu Stadt-POI */
  poiId?: number;
  /**
   * Stadt-Scope (Masterbook Location Isolation).
   * Hotels ohne cityId oder mit anderer cityId gelten in der aktiven Stadt als ungültig.
   */
  cityId?: string;
};

export type TravelItinerary = {
  rawText?: string;
  summary?: string;
  uploadedAt?: string;
  /** Strukturierter Extrakt aus Sprachnachrichten-Planmodus */
  structured?: {
    city?: string | null;
    hotelName?: string | null;
    checkInLocal?: string | null;
    checkOutLocal?: string | null;
    deadlines?: unknown[];
    stops?: unknown[];
    blocks?: unknown[];
    todos?: unknown[];
    preferences?: unknown[];
  };
};

type UserMemoryState = {
  entities: UserEntity[];
  travelItinerary?: TravelItinerary;
  /** Hotel-Kandidat wartet auf Ja/Nein */
  pendingHotelConfirmId: string | null;
  /** User soll Hotel-Namen nennen */
  awaitingHotelName: boolean;
  /** Nebenbei „fliegen“ → warte auf Wann / Flugnummer */
  awaitingFlightDetails: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
  addOrUpdateEntity: (partial: Partial<UserEntity> & { name: string }) => UserEntity;
  confirmEntity: (id: string) => void;
  removeEntity: (id: string) => void;
  getConfirmedHotel: (cityId?: string | null) => UserEntity | undefined;
  getHotelCandidate: (cityId?: string | null) => UserEntity | undefined;
  findEntities: (opts: {
    type?: UserEntityType;
    nameQuery?: string;
    sinceIso?: string;
    cityId?: string | null;
  }) => UserEntity[];
  setPendingHotelConfirm: (id: string | null) => void;
  setAwaitingHotelName: (awaiting: boolean) => void;
  setAwaitingFlightDetails: (awaiting: boolean) => void;
  setTravelItinerary: (plan: TravelItinerary | undefined) => void;
  /** Drop hotels that don't belong to activeCityId (incl. legacy unscoped). */
  clearHotelsOutsideCity: (activeCityId: string | null | undefined) => void;
  clearMemory: () => Promise<void>;
};

function resolveActiveCityId(explicit?: string | null): string | null {
  if (explicit != null && String(explicit).trim()) {
    return String(explicit).trim().toLowerCase();
  }
  try {
    // Lazy import — avoids circular boot deps with userProfileService
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCachedUserProfile } = require('../services/userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    const id = getCachedUserProfile()?.cityId;
    return id?.trim() ? id.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function hotelBelongsToCity(
  entity: UserEntity,
  activeCityId: string | null,
): boolean {
  if (entity.type !== 'hotel') return true;
  if (!activeCityId) return false;
  const scoped = entity.cityId?.trim().toLowerCase();
  // Legacy hotels without cityId are unsafe across cities → reject
  if (!scoped) return false;
  return scoped === activeCityId;
}

const MEMORY_PATH = `${FileSystem.documentDirectory}findus-user-memory.json`;

function newId(): string {
  return `ue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a).toLowerCase();
  const nb = normalizeName(b).toLowerCase();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function writeDisk(state: {
  entities: UserEntity[];
  travelItinerary?: TravelItinerary;
}): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      MEMORY_PATH,
      JSON.stringify(
        {
          entities: state.entities.slice(-200),
          travelItinerary: state.travelItinerary,
        },
        null,
        2,
      ),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch (err) {
    console.warn('[userMemory] persist failed:', err);
  }
}

export const useUserMemoryStore = create<UserMemoryState>((set, get) => ({
  entities: [],
  travelItinerary: undefined,
  pendingHotelConfirmId: null,
  awaitingHotelName: false,
  awaitingFlightDetails: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(MEMORY_PATH);
      if (!info.exists) {
        set({ hydrated: true });
        return;
      }
      const raw = await FileSystem.readAsStringAsync(MEMORY_PATH);
      const parsed = JSON.parse(raw) as {
        entities?: UserEntity[];
        travelItinerary?: TravelItinerary;
      };
      set({
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        travelItinerary: parsed.travelItinerary,
        hydrated: true,
      });
    } catch (err) {
      console.warn('[userMemory] hydrate failed:', err);
      set({ hydrated: true });
    }
  },

  persist: async () => {
    const { entities, travelItinerary } = get();
    await writeDisk({ entities, travelItinerary });
  },

  addOrUpdateEntity: (partial) => {
    const name = normalizeName(partial.name);
    if (!name) {
      throw new Error('UserEntity needs a name');
    }

    const type = partial.type ?? 'custom';
    const activeCity = resolveActiveCityId(partial.cityId);
    const stampedCityId =
      partial.cityId?.trim().toLowerCase() ||
      (type === 'hotel' ? activeCity ?? undefined : partial.cityId);

    const entities = [...get().entities];
    const existingIdx = entities.findIndex((e) => {
      if (partial.id && e.id === partial.id) return true;
      if (partial.poiId != null && e.poiId === partial.poiId) return true;
      const sameType = e.type === (partial.type ?? e.type);
      const sameName = namesMatch(e.name, name);
      if (!sameType || !sameName) return false;
      // Hotels: only match within same city scope
      if (type === 'hotel' || e.type === 'hotel') {
        const eCity = e.cityId?.trim().toLowerCase() ?? null;
        const pCity = stampedCityId ?? null;
        if (eCity && pCity) return eCity === pCity;
        if (eCity || pCity) return false;
      }
      return true;
    });

    let entity: UserEntity;
    if (existingIdx >= 0) {
      const prev = entities[existingIdx];
      entity = {
        ...prev,
        ...partial,
        id: prev.id,
        name: name || prev.name,
        type,
        cityId: stampedCityId ?? prev.cityId,
        isConfirmed: partial.isConfirmed ?? prev.isConfirmed,
        dwellTimeMinutes:
          partial.dwellTimeMinutes != null
            ? Math.max(prev.dwellTimeMinutes ?? 0, partial.dwellTimeMinutes)
            : prev.dwellTimeMinutes,
      };
      entities[existingIdx] = entity;
    } else {
      entity = {
        id: partial.id ?? newId(),
        type,
        name,
        isConfirmed: partial.isConfirmed ?? false,
        lat: partial.lat,
        lng: partial.lng,
        visitedAt: partial.visitedAt,
        dwellTimeMinutes: partial.dwellTimeMinutes,
        notes: partial.notes,
        poiId: partial.poiId,
        cityId: stampedCityId,
      };
      entities.push(entity);
    }

    set({ entities: entities.slice(-200) });
    void get().persist();
    return entity;
  },

  confirmEntity: (id) => {
    const entities = get().entities.map((e) =>
      e.id === id ? { ...e, isConfirmed: true } : e,
    );
    set({ entities, pendingHotelConfirmId: null, awaitingHotelName: false });
    void get().persist();
  },

  removeEntity: (id) => {
    set({
      entities: get().entities.filter((e) => e.id !== id),
      pendingHotelConfirmId:
        get().pendingHotelConfirmId === id
          ? null
          : get().pendingHotelConfirmId,
    });
    void get().persist();
  },

  getConfirmedHotel: (cityId) => {
    const active = resolveActiveCityId(cityId);
    return get().entities.find(
      (e) =>
        e.type === 'hotel' &&
        e.isConfirmed &&
        hotelBelongsToCity(e, active),
    );
  },

  getHotelCandidate: (cityId) => {
    const active = resolveActiveCityId(cityId);
    const hotels = get().entities.filter(
      (e) => e.type === 'hotel' && hotelBelongsToCity(e, active),
    );
    return (
      hotels.find((e) => !e.isConfirmed) ??
      hotels[hotels.length - 1]
    );
  },

  findEntities: ({ type, nameQuery, sinceIso, cityId }) => {
    let list = get().entities;
    if (type) list = list.filter((e) => e.type === type);
    const active = cityId !== undefined ? resolveActiveCityId(cityId) : null;
    if (type === 'hotel' || cityId !== undefined) {
      const scope = active ?? resolveActiveCityId(null);
      list = list.filter((e) =>
        e.type === 'hotel' ? hotelBelongsToCity(e, scope) : true,
      );
    }
    if (sinceIso) {
      const since = Date.parse(sinceIso);
      if (Number.isFinite(since)) {
        list = list.filter(
          (e) => e.visitedAt && Date.parse(e.visitedAt) >= since,
        );
      }
    }
    if (nameQuery?.trim()) {
      const q = nameQuery.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.notes?.toLowerCase().includes(q) ?? false),
      );
    }
    return [...list].sort((a, b) => {
      const ta = a.visitedAt ? Date.parse(a.visitedAt) : 0;
      const tb = b.visitedAt ? Date.parse(b.visitedAt) : 0;
      return tb - ta;
    });
  },

  setPendingHotelConfirm: (id) => set({ pendingHotelConfirmId: id }),
  setAwaitingHotelName: (awaiting) => set({ awaitingHotelName: awaiting }),
  setAwaitingFlightDetails: (awaiting) => set({ awaitingFlightDetails: awaiting }),
  setTravelItinerary: (plan) => {
    set({ travelItinerary: plan });
    void get().persist();
  },

  clearHotelsOutsideCity: (activeCityId) => {
    const active = resolveActiveCityId(activeCityId);
    const prev = get().entities;
    const next = prev.filter((e) => {
      if (e.type !== 'hotel') return true;
      return hotelBelongsToCity(e, active);
    });
    const removedIds = new Set(
      prev.filter((e) => e.type === 'hotel' && !next.includes(e)).map((e) => e.id),
    );
    if (removedIds.size === 0 && next.length === prev.length) return;

    const pending = get().pendingHotelConfirmId;
    set({
      entities: next,
      pendingHotelConfirmId:
        pending && removedIds.has(pending) ? null : pending,
      awaitingHotelName: false,
    });
    void get().persist();
    if (__DEV__) {
      console.log(
        `[userMemory] cleared ${removedIds.size} foreign/legacy hotel(s) for city=${active ?? 'none'}`,
      );
    }
  },

  clearMemory: async () => {
    set({
      entities: [],
      travelItinerary: undefined,
      pendingHotelConfirmId: null,
      awaitingHotelName: false,
      awaitingFlightDetails: false,
    });
    try {
      await FileSystem.deleteAsync(MEMORY_PATH, { idempotent: true });
    } catch {
      // ignore
    }
  },
}));

/** Prompt-Block für Gemini / Follow-ups */
export function formatUserMemoryForPrompt(): string {
  const { entities, travelItinerary } = useUserMemoryStore.getState();
  const activeCity = resolveActiveCityId(null);
  const scoped = entities.filter((e) =>
    e.type === 'hotel' ? hotelBelongsToCity(e, activeCity) : true,
  );
  if (!scoped.length && !travelItinerary?.rawText) {
    return 'Noch keine gespeicherten Orte im Langzeitgedächtnis.';
  }

  const lines = scoped.slice(-24).map((e) => {
    const conf = e.isConfirmed ? 'bestätigt' : 'Kandidat';
    const when = e.visitedAt
      ? ` · besucht ${e.visitedAt.slice(0, 16).replace('T', ' ')}`
      : '';
    const dwell =
      e.dwellTimeMinutes != null ? ` · ${e.dwellTimeMinutes} Min.` : '';
    const note = e.notes ? ` · Notiz: ${e.notes}` : '';
    const coords = '';
    const city =
      e.type === 'hotel' && e.cityId ? ` · Stadt ${e.cityId}` : '';
    return `- [${e.type}/${conf}] ${e.name}${when}${dwell}${note}${coords}${city}`;
  });

  const hotel = useUserMemoryStore.getState().getConfirmedHotel(activeCity);
  const hotelLine = hotel
    ? `\nBestätigtes Hotel (nur aktuelle Stadt): ${hotel.name}${
        hotel.cityId ? ` [${hotel.cityId}]` : ''
      }`
    : '\nKein bestätigtes Hotel in der aktuellen Stadt.';

  const itinerary = travelItinerary?.summary || travelItinerary?.rawText;
  const structuredBits = travelItinerary?.structured
    ? [
        travelItinerary.structured.city
          ? `Stadt ${travelItinerary.structured.city}`
          : null,
        travelItinerary.structured.hotelName
          ? `Hotel ${travelItinerary.structured.hotelName}`
          : null,
        Array.isArray(travelItinerary.structured.preferences) &&
        travelItinerary.structured.preferences.length
          ? `Prefs ${travelItinerary.structured.preferences.length}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const tripLine = itinerary
    ? `\nReiseplan-Auszug: ${itinerary.slice(0, 400)}${
        structuredBits ? ` (${structuredBits})` : ''
      }`
    : '';

  return `Langzeitgedächtnis (implizit gelernt — nutzen bei Navigation/Erinnerung):
${lines.join('\n') || '—'}
${hotelLine}${tripLine}`;
}
