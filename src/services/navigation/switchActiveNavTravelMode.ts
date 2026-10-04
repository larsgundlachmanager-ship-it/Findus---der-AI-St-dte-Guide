/**
 * Mid-nav Just-Do-It: aktive ÖPNV-/Rad-Route → Fuß (oder Rad) umstellen.
 * Alte Journey abbrechen, gleiche End-Destination, neue ETA ansagen.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import { formatDurationMinutesDe } from './travelEtaFormat';
import { estimateTravelEta } from './travelEta';
import {
  detectTravelModeVoiceOverride,
  setPreferredTravelMode,
  type TravelMode,
} from './travelModeContext';
import { isTransitMode, type TransportMode } from './transportMode';

export type SwitchActiveNavResult = {
  ok: boolean;
  speech: string;
  bullets: string[];
  mode: 'foot' | 'bike';
  destName: string;
};

/** „lieber zu Fuß“ / „doch mit dem Rad“ / Rad-ETA während aktiver Nav — Mode-Switch. */
export function isActiveNavTravelModeSwitchIntent(text: string): TravelMode | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const mode = detectTravelModeVoiceOverride(t);
  if (mode !== 'foot' && mode !== 'bike') return null;

  // Reine Restzeit-Fragen OHNE Rad/Fuß → Mobility-Agent, kein Route-Swap
  const mentionsMode =
    /\b(fahrrad|rad|bike|e-?bike|zu\s+fu(?:ss|ß|ße)|zu\s*fuss|laufen|gehend)\b/iu.test(
      t,
    );
  const hasSwitchVerb =
    /\b(lieber|doch|statt|umstell|wechsel|änder|aender|starte?|neu\s+planen|abbrechen|möchte|moechte|will|lass\s+uns|nehm(?:en)?\s+wir|geh(?:en)?\s+wir)\b/iu.test(
      t,
    ) ||
    /\b(zu\s+fu(?:ss|ß|ße)|zu\s*fuss)\s*(laufen|gehen)(?:\b|(?=\s|$))/iu.test(t) ||
    /\b(mit\s+dem\s+)?(fahrrad|rad)\s*(fahren|weiter)\b/iu.test(t) ||
    /\bich\s+bin\s+.{0,24}(zu\s+fu(?:ss|ß|ße)|zu\s*fuss|mit\s+dem\s+(fahrrad|rad|bike)|laufend)(?:\b|(?=\s|$))/iu.test(
      t,
    );

  // „Wie lange mit dem Fahrrad?“ während Nav → sofort Rad-Profil + Bike-ETA
  const bikeEtaAsk =
    mode === 'bike' &&
    mentionsMode &&
    /\b(wie\s+lange|noch\s+wie\s+lange|brauch(?:e|)\s+ich\s+noch|wie\s+weit|rest(?:weg|strecke)|eta|dauer|minuten)\b/iu.test(
      t,
    );

  const etaOnly =
    /\b(wie\s+lange|noch\s+wie\s+lange|brauch(?:e|)\s+ich\s+noch|wie\s+weit|rest(?:weg|strecke)|eta)\b/iu.test(
      t,
    ) &&
    !hasSwitchVerb &&
    !bikeEtaAsk;
  if (etaOnly) return null;

  if (!hasSwitchVerb && !bikeEtaAsk) return null;
  return mode;
}

function clockHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveFinalNavTarget(): {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
} | null {
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    if (tour?.stops?.length) {
      const destRole = [...tour.stops]
        .reverse()
        .find((s) => s.role === 'dest' && Number.isFinite(s.lat) && Number.isFinite(s.lng));
      const last = tour.stops[tour.stops.length - 1];
      const pick = destRole ?? last;
      if (
        pick &&
        Number.isFinite(pick.lat) &&
        Number.isFinite(pick.lng) &&
        String(pick.name || '').trim()
      ) {
        return {
          name: String(pick.name).trim(),
          lat: pick.lat,
          lng: pick.lng,
          poiId: pick.poiId > 0 ? pick.poiId : undefined,
        };
      }
    }
  } catch {
    /* soft */
  }
  try {
    const { peekRememberedJourney } = require('./journeyStartCache') as {
      peekRememberedJourney: () => {
        destName: string;
        destLat: number;
        destLng: number;
      } | null;
    };
    const remembered = peekRememberedJourney();
    if (
      remembered &&
      Number.isFinite(remembered.destLat) &&
      Number.isFinite(remembered.destLng)
    ) {
      return {
        name: (remembered.destName || 'Ziel').trim() || 'Ziel',
        lat: remembered.destLat,
        lng: remembered.destLng,
      };
    }
  } catch {
    /* soft */
  }
  try {
    const { getActiveNavDestination } = require('./navigationService') as {
      getActiveNavDestination: () => {
        name: string;
        lat: number;
        lng: number;
        poiId?: number;
      } | null;
    };
    const active = getActiveNavDestination();
    if (
      active &&
      Number.isFinite(active.lat) &&
      Number.isFinite(active.lng) &&
      String(active.name || '').trim()
    ) {
      return {
        name: String(active.name).trim(),
        lat: active.lat,
        lng: active.lng,
        poiId: active.poiId,
      };
    }
  } catch {
    /* soft */
  }
  try {
    const st = useFinnusStore.getState();
    const name = String(st.navTargetName || '').trim();
    // Ohne Koordinaten nicht raten
    if (!name) return null;
  } catch {
    /* soft */
  }
  return null;
}

/** Gewählter Pitch-Ort / lastPlaceName — auch wenn Nav schon beendet. */
export function resolveStickyPitchTarget(): {
  name: string;
  lat: number;
  lng: number;
} | null {
  try {
    const { useLivePitchStore } = require('../../module2/pitch/publishPitchUi') as {
      useLivePitchStore: {
        getState: () => {
          selectedOptionId: string | null;
          options: Array<{
            id: string;
            name: string;
            lat: number;
            lng: number;
          }>;
        };
      };
    };
    const st = useLivePitchStore.getState();
    const chosen = st.selectedOptionId
      ? st.options.find((o) => o.id === st.selectedOptionId)
      : null;
    const opt =
      chosen ||
      (st.options.length === 1 ? st.options[0] : null);
    if (
      opt &&
      Number.isFinite(opt.lat) &&
      Number.isFinite(opt.lng) &&
      !(opt.lat === 0 && opt.lng === 0) &&
      String(opt.name || '').trim()
    ) {
      return { name: String(opt.name).trim(), lat: opt.lat, lng: opt.lng };
    }
  } catch {
    /* soft */
  }
  try {
    const { getPitchSession } = require('../../module2/pitch/pitchDeepAppend') as {
      getPitchSession: (id: string) => {
        selectedOptionId: string | null;
        options: Array<{ id: string; name: string; lat: number; lng: number }>;
      } | null;
    };
    const { useLivePitchStore } = require('../../module2/pitch/publishPitchUi') as {
      useLivePitchStore: { getState: () => { requestId: string | null } };
    };
    const rid = useLivePitchStore.getState().requestId;
    if (rid) {
      const sess = getPitchSession(rid);
      const chosen = sess?.selectedOptionId
        ? sess.options.find((o) => o.id === sess.selectedOptionId)
        : null;
      const opt = chosen || (sess?.options.length === 1 ? sess.options[0] : null);
      if (
        opt &&
        Number.isFinite(opt.lat) &&
        Number.isFinite(opt.lng) &&
        String(opt.name || '').trim()
      ) {
        return { name: String(opt.name).trim(), lat: opt.lat, lng: opt.lng };
      }
    }
  } catch {
    /* soft */
  }
  return null;
}

function resolveModeSwitchTarget(): {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
} | null {
  return resolveFinalNavTarget() || resolveStickyPitchTarget();
}

/** Aktiver Nav-Bucket: transit / bike / foot. */
export function resolveActiveNavTravelBucket(): TravelMode | null {
  try {
    if (!useFinnusStore.getState().navActive) return null;
  } catch {
    return null;
  }
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    if (
      tour?.stops?.some(
        (s) =>
          s.role === 'board' ||
          s.role === 'alight' ||
          s.role === 'transfer' ||
          Boolean(s.vehicleMode) ||
          Boolean(s.line),
      )
    ) {
      return 'transit';
    }
  } catch {
    /* soft */
  }
  try {
    const { getCurrentTransportMode } = require('./navigationService') as {
      getCurrentTransportMode: () => TransportMode;
    };
    const mode = getCurrentTransportMode();
    if (isTransitMode(mode)) return 'transit';
    if (mode === 'bicycle') return 'bike';
  } catch {
    /* soft */
  }
  try {
    const pref = useFinnusStore.getState().preferredTravelMode;
    // Session-Override allein reicht nicht: User kann schon „foot“ gesetzt haben,
    // während die Karte noch ÖPNV zeigt — Transport/Tour zählen stärker (oben).
    if (pref === 'bike') return 'bike';
    if (pref === 'transit') return 'transit';
  } catch {
    /* soft */
  }
  return 'foot';
}

async function tearDownActiveJourneyKeepAudio(): Promise<void> {
  try {
    const { clearRememberedJourney } = require('./journeyStartCache') as {
      clearRememberedJourney: () => void;
    };
    clearRememberedJourney();
  } catch {
    /* soft */
  }
  try {
    const { stopJourneyLeaveWatch } = require('./journeyLeaveBy') as {
      stopJourneyLeaveWatch: (reason?: string) => void;
    };
    stopJourneyLeaveWatch('mode_switch');
  } catch {
    /* soft */
  }
  try {
    const { clearMultiStopTour } = require('./multiStopTour') as {
      clearMultiStopTour: () => void;
    };
    clearMultiStopTour();
  } catch {
    /* soft */
  }
  try {
    const { suppressLiveNavMirror } = require('../../module2/timeline/syncLiveNavToPlan') as {
      suppressLiveNavMirror: () => void;
    };
    suppressLiveNavMirror();
  } catch {
    /* soft */
  }
  try {
    const { stopNavigation } = require('./navigationService') as {
      stopNavigation: (o?: { silent?: boolean; reason?: string }) => Promise<void>;
    };
    await Promise.race([
      stopNavigation({ silent: true, reason: 'manual' }),
      new Promise<void>((r) => setTimeout(r, 700)),
    ]);
  } catch {
    /* soft */
  }
  try {
    const { clearLiveNavFromPlan } = await import('../../module2/timeline/syncLiveNavToPlan');
    clearLiveNavFromPlan({ abandon: true });
  } catch {
    /* soft */
  }
}

function estimateEtaMinForTarget(
  mode: 'foot' | 'bike',
  target: { lat: number; lng: number; name?: string },
): number {
  try {
    const gps = useGpsStore.getState();
    const st = useFinnusStore.getState();
    const fromLat = gps.lat ?? st.lastGpsLat;
    const fromLng = gps.lng ?? st.lastGpsLng;
    if (
      typeof fromLat === 'number' &&
      typeof fromLng === 'number' &&
      Number.isFinite(fromLat) &&
      Number.isFinite(fromLng)
    ) {
      const eta = estimateTravelEta({
        userLat: fromLat,
        userLng: fromLng,
        destLat: target.lat,
        destLng: target.lng,
        destName: target.name,
      });
      return mode === 'bike'
        ? Math.max(1, Math.round(eta.bikeMinutes))
        : Math.max(1, Math.round(eta.directWalkMinutes));
    }
  } catch {
    /* soft */
  }
  return 15;
}

function buildConfirmSpeech(opts: {
  mode: 'foot' | 'bike';
  destName: string;
  etaMin: number;
  fromBucket?: TravelMode | null;
  freshStart?: boolean;
}): { speech: string; bullets: string[] } {
  const dur = formatDurationMinutesDe(opts.etaMin, 'speech');
  const arrive = clockHm(Date.now() + opts.etaMin * 60_000);
  const modeLabel = opts.mode === 'bike' ? 'mit dem Rad' : 'zu Fuß';
  const fromTransit = opts.fromBucket === 'transit';
  const speech = opts.freshStart
    ? `Alles klar — ich bereite die Route ${modeLabel} nach ${opts.destName} vor. Etwa ${dur}, Ankunft gegen ${arrive}.`
    : fromTransit
      ? `Alles klar — ich beende die ÖPNV-Route und führ dich jetzt ${modeLabel} nach ${opts.destName}. Das dauert etwa ${dur}, Ankunft gegen ${arrive}.`
      : `Alles klar — ich stell die Navigation auf ${modeLabel} um, weiter nach ${opts.destName}. Etwa ${dur}, Ankunft gegen ${arrive}.`;
  const bullets = [
    opts.destName,
    opts.mode === 'bike' ? 'Rad' : 'Zu Fuß',
    `Ankunft ~${arrive}`,
  ].slice(0, 3);
  return { speech, bullets };
}

/**
 * Sync-Vorschau für Early-Bridge (Bestätigung + Dauer), bevor die neue Route fertig ist.
 * null = kein Switch nötig/möglich.
 */
export function previewActiveNavModeSwitchBridge(
  mode: 'foot' | 'bike',
): SwitchActiveNavResult | null {
  let navLive = false;
  try {
    navLive = Boolean(useFinnusStore.getState().navActive);
  } catch {
    navLive = false;
  }
  const target = resolveModeSwitchTarget();
  if (!target) return null;
  if (navLive) {
    const current = resolveActiveNavTravelBucket();
    if (current === mode) return null;
  }
  const etaMin = estimateEtaMinForTarget(mode, target);
  const { speech, bullets } = buildConfirmSpeech({
    mode,
    destName: target.name,
    etaMin,
    fromBucket: navLive ? resolveActiveNavTravelBucket() : null,
    freshStart: !navLive,
  });
  return { ok: true, speech, bullets, mode, destName: target.name };
}

/** Eine Zeile für Call-1 FLAG — damit der Planer Mode-Switch selbst ableitet. */
export function formatActiveNavCall1Flag(): string | null {
  try {
    if (!useFinnusStore.getState().navActive) return null;
  } catch {
    return null;
  }
  const bucket = resolveActiveNavTravelBucket() ?? 'foot';
  const modeDe =
    bucket === 'transit' ? 'ÖPNV' : bucket === 'bike' ? 'Rad' : 'Fuß';
  const target = resolveFinalNavTarget();
  const dest = target?.name ? `; Ziel: ${target.name}` : '';
  return (
    `FLAG: Navigation läuft (Modus: ${modeDe}${dest}). ` +
    'Will der User einen anderen Modus (lieber zu Fuß / Rad / ÖPNV) → execution=nav_execute, lane=nav. ' +
    'Bridge sagt klar zu: alte Route beenden + neue zum selben Ziel; Dauer/Ankunft in der Bridge ok (Just-Do-It). Keine Permission-Frage.'
  );
}

/**
 * Bricht aktive ÖPNV-/fremde Mode-Nav ab und startet Fuß/Rad zum Endziel.
 * Returns null wenn kein Switch nötig/möglich.
 */
export async function trySwitchActiveNavTravelMode(
  mode: 'foot' | 'bike',
  _userText?: string,
): Promise<SwitchActiveNavResult | null> {
  let navLive = false;
  try {
    navLive = Boolean(useFinnusStore.getState().navActive);
  } catch {
    navLive = false;
  }

  const target = resolveModeSwitchTarget();
  if (!target) return null;

  const current = navLive ? resolveActiveNavTravelBucket() : null;
  if (navLive && current === mode) return null;

  try {
    const { markNavOpeningSpoken } = require('./landmarkNavCoach') as {
      markNavOpeningSpoken: () => void;
    };
    markNavOpeningSpoken();
  } catch {
    /* soft */
  }

  if (navLive) {
    await tearDownActiveJourneyKeepAudio();
  }

  if (mode === 'bike') {
    try {
      const { forceBikeModeFromVoice } = require('./travelModeContext') as {
        forceBikeModeFromVoice: () => void;
      };
      forceBikeModeFromVoice();
    } catch {
      setPreferredTravelMode('bike');
    }
  } else {
    setPreferredTravelMode('foot');
  }

  try {
    useFinnusStore.getState().setNavRouteLoading(true);
  } catch {
    /* soft */
  }

  let ok = false;
  try {
    const { startHomeMapNavigation } = await import('../homeMap/homeMapNavStart');
    const res = await startHomeMapNavigation(
      {
        name: target.name,
        lat: target.lat,
        lng: target.lng,
        poiId: target.poiId,
      },
      undefined,
      { commitMode: mode, replaceRoute: true },
    );
    ok = res.ok === true;
  } catch {
    ok = false;
  }

  if (!ok) {
    try {
      useFinnusStore.getState().setNavRouteLoading(false);
    } catch {
      /* soft */
    }
    return {
      ok: false,
      mode,
      destName: target.name,
      speech:
        'Die Route hat gerade nicht gestartet. Sag nochmal „Route zu Fuß“, dann versuche ich es erneut.',
      bullets: [target.name, mode === 'bike' ? 'Rad' : 'Zu Fuß'],
    };
  }

  let etaMin = estimateEtaMinForTarget(mode, target);
  try {
    const storeEta = useFinnusStore.getState().navEtaMin;
    if (typeof storeEta === 'number' && storeEta > 0) {
      etaMin = Math.max(1, Math.round(storeEta));
    }
  } catch {
    /* soft */
  }

  const { speech, bullets } = buildConfirmSpeech({
    mode,
    destName: target.name,
    etaMin,
    fromBucket: current,
    freshStart: !navLive,
  });
  return { ok: true, speech, bullets, mode, destName: target.name };
}
