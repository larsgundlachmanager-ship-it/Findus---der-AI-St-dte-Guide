/**
 * Hotel / Unterkunft als Tages-Basis:
 * - explizit genannt → speichern + setDayBase
 * - ~20 Min Dwell an hotel-ähnlichem Ort → einmal nachfragen
 */

import { todayDateKey } from '../../utils/dateKeys';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { speakRuntimeText } from '../../runtime/speechModule';
import { getVoiceSettingsForTour } from '../ttsService';
import { isNachtruhe } from '../ui/nachtruhePolicy';

const LODGING_RE =
  /\b(hotel|pension|hostel|gastehaus|gästehaus|unterkunft|boardinghouse|motel|apartment\s*hotel|bett\s*for\s*night)\b/iu;

const DWELL_ASK_MS = 20 * 60_000;
const ASK_COOLDOWN_MS = 6 * 60 * 60_000;

let dwellStartedAt: number | null = null;
let dwellPlaceKey: string | null = null;
let lastAskAt = 0;
let askedForKey: string | null = null;

export function applyConfirmedHotelAsDayBase(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
}): void {
  const name = opts.name.trim().slice(0, 48);
  if (!name) return;
  const store = useFinnusStore.getState();
  const lat =
    typeof opts.lat === 'number' && Number.isFinite(opts.lat)
      ? opts.lat
      : store.lastGpsLat ?? undefined;
  const lng =
    typeof opts.lng === 'number' && Number.isFinite(opts.lng)
      ? opts.lng
      : store.lastGpsLng ?? undefined;
  try {
    useFuturePlanStore.getState().setDayBase(todayDateKey(), {
      label: name,
      kind: 'hotel',
      lat: lat ?? undefined,
      lng: lng ?? undefined,
    });
  } catch {
    /* soft */
  }
}

function lodgingLabelFromPresence(): string | null {
  const store = useFinnusStore.getState();
  const name = store.currentLocationName?.trim() || '';
  if (!name) return null;
  if (LODGING_RE.test(name)) return name.slice(0, 48);
  return null;
}

/**
 * GPS-Tick: nach ~20 Min an hotel-ähnlichem Ort einmal nachfragen.
 */
export async function tickHotelBasePresenceAsk(opts?: {
  lat?: number | null;
  lng?: number | null;
}): Promise<void> {
  void opts;
  const mem = useUserMemoryStore.getState();
  const confirmed = mem.getConfirmedHotel();
  const store = useFinnusStore.getState();
  if (store.isListening || store.isGenerating || store.isAudiblySpeaking) return;
  if (store.navActive) {
    dwellStartedAt = null;
    dwellPlaceKey = null;
    return;
  }
  if (isNachtruhe()) return;

  const label = lodgingLabelFromPresence();
  if (!label) {
    dwellStartedAt = null;
    dwellPlaceKey = null;
    return;
  }

  const key = label.toLowerCase();
  if (
    confirmed &&
    confirmed.name.toLowerCase().replace(/^hotel\s+/i, '') ===
      key.replace(/^hotel\s+/i, '')
  ) {
    dwellStartedAt = null;
    dwellPlaceKey = null;
    return;
  }

  const now = Date.now();
  if (dwellPlaceKey !== key) {
    dwellPlaceKey = key;
    dwellStartedAt = now;
    return;
  }
  if (dwellStartedAt == null) {
    dwellStartedAt = now;
    return;
  }
  if (now - dwellStartedAt < DWELL_ASK_MS) return;
  if (askedForKey === key && now - lastAskAt < ASK_COOLDOWN_MS) return;
  if (mem.pendingHotelConfirmId || mem.awaitingHotelName) return;

  lastAskAt = now;
  askedForKey = key;

  const short = label.replace(/^Hotel\s+/i, '');
  const entity = mem.addOrUpdateEntity({
    type: 'hotel',
    name: /^hotel\b/i.test(label) ? label : `Hotel ${label}`,
    isConfirmed: false,
    lat: store.lastGpsLat ?? undefined,
    lng: store.lastGpsLng ?? undefined,
    notes: 'Dwell ~20 Min — wartet auf Bestätigung als Basis',
    visitedAt: new Date().toISOString(),
  });
  mem.setPendingHotelConfirm(entity.id);

  const line = `Du bist schon eine Weile hier bei „${short}“. Ist das dein Hotel bzw. deine Unterkunft — und wie lange bleibst du? Dann nehm ich das als Basis.`;
  try {
    const voice = await getVoiceSettingsForTour();
    store.addChatMessage({ role: 'assistant', content: line });
    await speakRuntimeText(
      line,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
  } catch {
    /* soft */
  }
}

/** Antwort auf Hotel-Basis-Frage / klaren Confirm. */
export function tryConfirmPendingHotelFromUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const mem = useUserMemoryStore.getState();
  const pendingId = mem.pendingHotelConfirmId;
  if (!pendingId) return false;

  const yes =
    /\b(ja|jap|jo|genau|richtig|stimmt|ist\s+mein\s+hotel|das\s+ist\s+(?:mein|unser)\s+hotel|als\s+basis|homebase|merk(?:e)?\s+dir)\b/iu.test(
      t,
    );
  const no =
    /\b(nein|nö|noe|nicht\s+mein\s+hotel|falsch|anders)\b/iu.test(t);
  if (no) {
    mem.setPendingHotelConfirm(null);
    return true;
  }
  if (!yes && !/\b(\d+\s*(?:tag|nacht|nächte|naechte)|bis\s+\w+)/iu.test(t)) {
    return false;
  }

  const entity = mem.entities.find((e) => e.id === pendingId);
  if (!entity) {
    mem.setPendingHotelConfirm(null);
    return false;
  }
  mem.confirmEntity(pendingId);
  mem.setPendingHotelConfirm(null);
  mem.setAwaitingHotelName(false);
  applyConfirmedHotelAsDayBase({
    name: entity.name,
    lat: entity.lat,
    lng: entity.lng,
  });
  return true;
}
