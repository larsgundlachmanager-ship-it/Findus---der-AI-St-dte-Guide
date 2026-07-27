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
};

export type TravelItinerary = {
  rawText?: string;
  summary?: string;
  uploadedAt?: string;
};

type UserMemoryState = {
  entities: UserEntity[];
  travelItinerary?: TravelItinerary;
  /** Hotel-Kandidat wartet auf Ja/Nein */
  pendingHotelConfirmId: string | null;
  /** User soll Hotel-Namen nennen */
  awaitingHotelName: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
  addOrUpdateEntity: (partial: Partial<UserEntity> & { name: string }) => UserEntity;
  confirmEntity: (id: string) => void;
  removeEntity: (id: string) => void;
  getConfirmedHotel: () => UserEntity | undefined;
  getHotelCandidate: () => UserEntity | undefined;
  findEntities: (opts: {
    type?: UserEntityType;
    nameQuery?: string;
    sinceIso?: string;
  }) => UserEntity[];
  setPendingHotelConfirm: (id: string | null) => void;
  setAwaitingHotelName: (awaiting: boolean) => void;
  setTravelItinerary: (plan: TravelItinerary | undefined) => void;
  clearMemory: () => Promise<void>;
};

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

    const entities = [...get().entities];
    const existingIdx = entities.findIndex((e) => {
      if (partial.id && e.id === partial.id) return true;
      if (partial.poiId != null && e.poiId === partial.poiId) return true;
      return (
        e.type === (partial.type ?? e.type) && namesMatch(e.name, name)
      );
    });

    let entity: UserEntity;
    if (existingIdx >= 0) {
      const prev = entities[existingIdx];
      entity = {
        ...prev,
        ...partial,
        id: prev.id,
        name: name || prev.name,
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
        type: partial.type ?? 'custom',
        name,
        isConfirmed: partial.isConfirmed ?? false,
        lat: partial.lat,
        lng: partial.lng,
        visitedAt: partial.visitedAt,
        dwellTimeMinutes: partial.dwellTimeMinutes,
        notes: partial.notes,
        poiId: partial.poiId,
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

  getConfirmedHotel: () =>
    get().entities.find((e) => e.type === 'hotel' && e.isConfirmed),

  getHotelCandidate: () => {
    const hotels = get().entities.filter((e) => e.type === 'hotel');
    return (
      hotels.find((e) => !e.isConfirmed) ??
      hotels[hotels.length - 1]
    );
  },

  findEntities: ({ type, nameQuery, sinceIso }) => {
    let list = get().entities;
    if (type) list = list.filter((e) => e.type === type);
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
  setTravelItinerary: (plan) => {
    set({ travelItinerary: plan });
    void get().persist();
  },

  clearMemory: async () => {
    set({
      entities: [],
      travelItinerary: undefined,
      pendingHotelConfirmId: null,
      awaitingHotelName: false,
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
  if (!entities.length && !travelItinerary?.rawText) {
    return 'Noch keine gespeicherten Orte im Langzeitgedächtnis.';
  }

  const lines = entities.slice(-24).map((e) => {
    const conf = e.isConfirmed ? 'bestätigt' : 'Kandidat';
    const when = e.visitedAt
      ? ` · besucht ${e.visitedAt.slice(0, 16).replace('T', ' ')}`
      : '';
    const dwell =
      e.dwellTimeMinutes != null ? ` · ${e.dwellTimeMinutes} Min.` : '';
    const note = e.notes ? ` · Notiz: ${e.notes}` : '';
    const coords =
      e.lat != null && e.lng != null
        ? ` · GPS ${e.lat.toFixed(5)},${e.lng.toFixed(5)}`
        : '';
    return `- [${e.type}/${conf}] ${e.name}${when}${dwell}${note}${coords}`;
  });

  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const hotelLine = hotel
    ? `\nBestätigtes Hotel: ${hotel.name}`
    : '';

  const itinerary = travelItinerary?.summary || travelItinerary?.rawText;
  const tripLine = itinerary
    ? `\nReiseplan-Auszug: ${itinerary.slice(0, 400)}`
    : '';

  return `Langzeitgedächtnis (implizit gelernt — nutzen bei Navigation/Erinnerung):
${lines.join('\n') || '—'}
${hotelLine}${tripLine}`;
}
