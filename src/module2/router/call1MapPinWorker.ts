/**
 * Map-Pin Worker — „Zeig X auf der Karte“
 * Resolve Ort → Place-Popup (Store). Keine Kamera-Refs.
 */

import type { Module2ActionButton } from '../types';

export type MapPinResult = {
  ok: boolean;
  subject: string | null;
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  promptBlock: string;
};

const MAP_PIN_RE =
  /\b(?:zeig(?:\s+mir)?|markier(?:e)?|pin(?:ne)?)\s+(?:mir\s+)?(?:den|die|das|dem|der)?\s*(.+?)\s+auf\s+der\s+karte\b/iu;
const WHERE_ON_MAP_RE =
  /\bwo\s+ist\s+(?:denn\s+)?(?:der|die|das)?\s*(.+?)\s+auf\s+der\s+karte\b/iu;
const PIN_SHORT_RE =
  /\b(?:karte\s+(?:zeigen|öffnen|oeffnen)|zeig(?:\s+mir)?\s+(?:die\s+)?karte)\b/iu;

export function wantsMapPin(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (MAP_PIN_RE.test(t) || WHERE_ON_MAP_RE.test(t)) return true;
  if (/\b(pin|markier)\b/iu.test(t) && /\b(karte|map)\b/iu.test(t)) return true;
  return false;
}

/** Pure — Subject aus „Zeig … auf der Karte“. */
export function extractMapPinSubject(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(MAP_PIN_RE) || t.match(WHERE_ON_MAP_RE);
  let raw = (m?.[1] || '').trim();
  if (!raw) return null;
  raw = raw
    .replace(/^(mir\s+)?(den|die|das|dem|der)\s+/iu, '')
    .replace(/[?.!,]+$/u, '')
    .trim();
  if (raw.length < 2 || raw.length > 64) return null;
  if (/^(mir|bitte|mal|doch)$/iu.test(raw)) return null;
  return raw;
}

export function wantsBareMapOpen(text: string): boolean {
  return PIN_SHORT_RE.test((text || '').replace(/\s+/g, ' ').trim());
}

function stableTempId(name: string, lat: number, lng: number): number {
  const s = `${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const id = Math.abs(h) % 900_000_000;
  return id === 0 ? 1 : -id;
}

export async function researchMapPin(opts: {
  userText: string;
  cityHint?: string | null;
  lat?: number | null;
  lng?: number | null;
  signal?: AbortSignal;
}): Promise<MapPinResult> {
  if (opts.signal?.aborted) {
    return {
      ok: false,
      subject: null,
      spokenDraft: 'FAKTEN Map-Pin: abgebrochen.',
      bullets: [],
      buttons: [],
      promptBlock: 'aborted',
    };
  }

  const subject = extractMapPinSubject(opts.userText);
  if (!subject) {
    if (wantsBareMapOpen(opts.userText)) {
      const spokenDraft = [
        'FAKTEN Map-Pin: Karte öffnen ohne Ort.',
        'FLOW: kurz bestätigen; User nach Ortsnamen fragen wenn Pin gewünscht.',
      ].join('\n');
      return {
        ok: true,
        subject: null,
        spokenDraft,
        bullets: ['Karte'],
        buttons: [
          {
            id: 'open_map',
            label: '🗺️ Karte',
            payload: { kind: 'ui', action: 'open_map' },
          },
        ],
        promptBlock: spokenDraft,
      };
    }
    const spokenDraft = [
      'FAKTEN Map-Pin: kein Ortsname erkannt.',
      'FLOW: nachfragen welchen Ort auf die Karte — nichts erfinden.',
    ].join('\n');
    return {
      ok: false,
      subject: null,
      spokenDraft,
      bullets: [],
      buttons: [],
      promptBlock: spokenDraft,
    };
  }

  let resolved: {
    lat: number;
    lng: number;
    label: string;
    source?: string;
  } | null = null;

  try {
    const {
      resolvePlacePackOsmGoogle,
    } = require('../../services/navigation/packPlaceResolve') as {
      resolvePlacePackOsmGoogle: (o: {
        query: string;
        cityHint?: string | null;
        biasLat?: number;
        biasLng?: number;
      }) => Promise<{
        lat: number;
        lng: number;
        label: string;
        source: string;
      } | null>;
    };
    resolved = await resolvePlacePackOsmGoogle({
      query: subject,
      cityHint: opts.cityHint,
      biasLat: opts.lat ?? undefined,
      biasLng: opts.lng ?? undefined,
    });
  } catch {
    resolved = null;
  }

  if (!resolved) {
    const spokenDraft = [
      `FAKTEN Map-Pin: „${subject}“ nicht gefunden.`,
      'FLOW: ehrlich sagen; alternativ Schreibweise/Stadt nachfragen. Kein Fake-Pin.',
    ].join('\n');
    return {
      ok: false,
      subject,
      spokenDraft,
      bullets: [subject.slice(0, 72)],
      buttons: [],
      promptBlock: spokenDraft,
    };
  }

  try {
    const { instantMapPlacePopup } = require('../../services/homeMap/mapPlacePreview') as {
      instantMapPlacePopup: (o: {
        id: number;
        name?: string | null;
        lat?: number | null;
        lng?: number | null;
      }) => unknown;
    };
    const { useHomeMapUiStore } = require('../../store/useHomeMapUiStore') as {
      useHomeMapUiStore: {
        getState: () => { setPlacePopup: (p: unknown) => void };
      };
    };
    const popup = instantMapPlacePopup({
      id: stableTempId(resolved.label, resolved.lat, resolved.lng),
      name: resolved.label,
      lat: resolved.lat,
      lng: resolved.lng,
    });
    useHomeMapUiStore.getState().setPlacePopup(popup);
  } catch {
    /* soft — Speech trotzdem */
  }

  try {
    const {
      armWegweiserMapPreview,
    } = require('../../services/navigation/wegweiserMapPreview') as {
      armWegweiserMapPreview?: (o: {
        poiId: number;
        name: string;
        lat: number;
        lng: number;
      }) => Promise<void>;
    };
    void armWegweiserMapPreview?.({
      poiId: stableTempId(resolved.label, resolved.lat, resolved.lng),
      name: resolved.label,
      lat: resolved.lat,
      lng: resolved.lng,
    });
  } catch {
    /* soft */
  }

  const spokenDraft = [
    `FAKTEN Map-Pin: ${resolved.label} bei ${resolved.lat.toFixed(5)}, ${resolved.lng.toFixed(5)} (${resolved.source || 'resolve'}).`,
    'FLOW: kurz bestätigen dass der Ort auf der Karte liegt; optional Route-Button. Keine Adresse vorlesen außer gefragt.',
  ].join('\n');

  const buttons: Module2ActionButton[] = [
    {
      id: 'nav_map_pin',
      label: '🧭 Route',
      payload: {
        kind: 'navigate',
        lat: resolved.lat,
        lng: resolved.lng,
        label: resolved.label,
      },
    },
  ];

  return {
    ok: true,
    subject,
    spokenDraft,
    bullets: [resolved.label.slice(0, 72), 'Auf der Karte'].slice(0, 3),
    buttons,
    promptBlock: spokenDraft,
  };
}
