/**
 * Early Just-Do-It — vor LLM: Intent erkennen und WIRKLICH ausführen.
 * Wecker/Timer, Erinnerungen, Parken, Lautstärke, Nahschauen/Street View.
 * Struktur-Blaupause — kein Script-Wortlaut.
 */

import type { QuickAction } from '../../types/concierge';
import { isClockIntent, prepareClockIntentFollowUp } from '../alarms/clockIntents';
import {
  buildRemindOnlyQuickAction,
  userAsksRemind,
} from './reminderActionPolicy';
import { classifyTimeCareIntent } from './timeCareIntent';
import {
  applyUserTtsVolume,
  getUserTtsVolumeMul,
  nudgeUserTtsVolume,
  volumeLevelLabel,
} from '../speech/ttsVolumePref';

export type EarlyJustDoItResult = {
  kind: 'wake' | 'timer' | 'reminder' | 'volume' | 'street_view' | 'parking' | 'transit' | 'charge' | 'flight' | 'playlist';
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
};

const VOLUME_INTENT =
  /\b(?:lauter|leiser|zu\s+laut|zu\s+leise|lautstärke|lautstaerke|volume|mach(?:e)?\s+(?:es\s+)?(?:lauter|leiser)|stell(?:e)?\s+(?:die\s+)?(?:lautstärke|lautstaerke)|sprich\s+(?:lauter|leiser)|etwas\s+lauter|etwas\s+leiser|ganz\s+laut|ganz\s+leise|normal\s+laut)\b/iu;

const LOOK_NEAR_INTENT =
  /\b(?:street\s*view|straßenansicht|strassenansicht|nahschau\w*|schau\s+(?:mal\s+)?nah|zeig(?:e|)\s+(?:mal\s+)?(?:die\s+)?(?:kreuzung|straße|strasse|aufnahme)|live[-\s]?aufnahme|hast\s+du\s+(?:das\s+)?nicht\s+gesehen|nicht\s+gesehen\??|schau\s+(?:dir\s+)?(?:das|die\s+kreuzung)|aufnahme\s+(?:zeigen|bitte))\b/iu;

export function isVolumeIntent(text: string): boolean {
  return VOLUME_INTENT.test(text.replace(/\s+/g, ' ').trim());
}

export function isLookNearIntent(text: string): boolean {
  return LOOK_NEAR_INTENT.test(text.replace(/\s+/g, ' ').trim());
}

function parseVolumeDir(
  text: string,
): 'up' | 'down' | 'max' | 'min' | 'reset' {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/\b(?:normal|zurück|zurueck|reset)\b/iu.test(t)) return 'reset';
  if (/\b(?:ganz\s+laut|maximal|volle\s+kanne)\b/iu.test(t)) return 'max';
  if (/\b(?:ganz\s+leise|minimal|flüster|fluester)\b/iu.test(t)) return 'min';
  if (/\b(?:leiser|zu\s+laut|leise)\b/iu.test(t)) return 'down';
  return 'up';
}

async function runVolumeJustDoIt(text: string): Promise<EarlyJustDoItResult> {
  const dir = parseVolumeDir(text);
  const mul = nudgeUserTtsVolume(dir);
  const label = volumeLevelLabel(mul);
  const pct = Math.round(mul * 100);
  if (!/\bsprich\b/iu.test(text)) {
    void import('../speech/deviceAudioRoute')
      .then((m) => {
        const d =
          dir === 'reset' ? null : dir === 'max' ? 'max' : dir === 'min' ? 'min' : dir;
        if (d && typeof m.nudgeDeviceMediaVolume === 'function') {
          return m.nudgeDeviceMediaVolume(d);
        }
        return undefined;
      })
      .catch(() => undefined);
  }
  return {
    kind: 'volume',
    speech:
      dir === 'reset'
        ? 'Alles klar — Lautstärke wieder normal.'
        : `Alles klar — ich spreche jetzt ${label} (${pct} Prozent).`,
    bullets: [`Lautstärke ${pct}%`, label],
    quickActions: [
      {
        type: 'SHOW_MORE',
        label: 'Lauter',
        payload: { textPrompt: 'Sprich lauter' },
      },
      {
        type: 'SHOW_MORE',
        label: 'Leiser',
        payload: { textPrompt: 'Sprich leiser' },
      },
      {
        type: 'SHOW_MORE',
        label: 'Normal',
        payload: { textPrompt: 'Lautstärke normal' },
      },
    ],
    cardTitle: 'Lautstärke',
  };
}

async function runParkingJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  try {
    const { researchParkingCare } = await import(
      '../../module2/reboot/parkingFactLane'
    );
    const r = await researchParkingCare({ userText: text });
    return {
      kind: 'parking',
      speech: r.draftText || 'Parkplatz ist gespeichert.',
      bullets: (r.bullets ?? []).slice(0, 3),
      quickActions: [],
      cardTitle: 'Parken',
    };
  } catch {
    return null;
  }
}

async function runReminderJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  if (!userAsksRemind(text)) return null;
  if (isClockIntent(text)) return null;

  const action = buildRemindOnlyQuickAction({
    userText: text,
    requireOfferOrAsk: false,
  });
  if (!action) {
    return {
      kind: 'reminder',
      speech:
        'Klar — sag mir Uhrzeit oder Ort, dann stelle ich die Erinnerung echt.',
      bullets: ['Uhrzeit oder Ort nötig'],
      quickActions: [
        {
          type: 'SHOW_MORE',
          label: 'In 30 Min',
          payload: { textPrompt: 'Erinner mich in 30 Minuten' },
        },
        {
          type: 'SHOW_MORE',
          label: 'Um 18 Uhr',
          payload: { textPrompt: 'Erinner mich um 18 Uhr' },
        },
      ],
      cardTitle: 'Erinnerung',
    };
  }

  const { handleQuickAction } = await import('../actionHandlerService');
  const r = await handleQuickAction(action);
  const ok = r.ok !== false;
  return {
    kind: 'reminder',
    speech:
      r.message ||
      (ok
        ? 'Erinnerung ist gestellt.'
        : 'Erinnerung ging gerade nicht — nochmal versuchen.'),
    bullets: ok
      ? [
          action.payload.timeLabel
            ? `⏰ ${action.payload.timeLabel}`
            : 'Erinnerung aktiv',
          action.payload.destName
            ? String(action.payload.destName)
            : 'Zeitlicher Trigger',
        ].filter(Boolean)
      : ['Nicht gestellt'],
    quickActions: ok
      ? []
      : [
          {
            ...action,
            label: 'Nochmal erinnern',
          },
        ],
    cardTitle: 'Erinnerung',
  };
}

async function runLookNearJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  if (!isLookNearIntent(text)) return null;
  try {
    const {
      fulfillStreetViewVoiceAsk,
      isStreetViewVoiceAsk,
    } = await import('../navigation/lookAheadBuffer');
    const r = await fulfillStreetViewVoiceAsk();
    if (r.ok) {
      return {
        kind: 'street_view',
        speech: r.message || 'Street View ist offen.',
        bullets: ['Nahansicht geöffnet'],
        quickActions: [],
        cardTitle: 'Nahschauen',
      };
    }
    return {
      kind: 'street_view',
      speech:
        r.message ||
        'Gerade habe ich keine Kreuzungs-Ansicht parat — sobald wir an einer unübersichtlichen Stelle sind, biete ich sie an.',
      bullets: ['Kein Street-View-Angebot aktiv'],
      quickActions: isStreetViewVoiceAsk(text)
        ? []
        : [
            {
              type: 'SHOW_MORE',
              label: 'Karte öffnen',
              payload: { textPrompt: 'Zeig mir die Karte' },
            },
          ],
      cardTitle: 'Nahschauen',
    };
  } catch {
    return null;
  }
}

/**
 * Vor Manager/Pitch: echte Ausführung oder null (weiter normal).
 */
export async function tryEarlyJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // Kein Flug hier. Uhrzeit/morgen/Session dürfen den Turn nicht vor dem Manager stehlen.
  // Wecker, Timer, Lautstärke, Parken, Erinnerung bleiben Just-Do-It —
  // außer der Satz ist ein Tagesplan (Wecker erst am Planende).
  try {
    const { clockIntentYieldsToDayPlan } = require('../../module2/planning/planClockGuard') as {
      clockIntentYieldsToDayPlan: (s: string) => boolean;
    };
    if (clockIntentYieldsToDayPlan(t)) return null;
  } catch {
    /* soft */
  }

  const care = classifyTimeCareIntent(t);

  if (care?.kind === 'parking') {
    try {
      const { isParkingSearchIntent } = require('./timeCareIntent') as {
        isParkingSearchIntent: (s: string) => boolean;
      };
      if (isParkingSearchIntent(t)) {
        /* Suche → Pitch, nicht „Parkplatz speichern“ */
      } else {
        const park = await runParkingJustDoIt(t);
        if (park) return park;
      }
    } catch {
      const park = await runParkingJustDoIt(t);
      if (park) return park;
    }
  }

  // Bahn/Leave-by ± Wecker — vor reinem Clock-Pfad (sonst wird Abfahrt als Weckzeit gelesen)
  if (
    care?.kind === 'compound_wake_transit' ||
    care?.kind === 'transit_leave'
  ) {
    try {
      const { executeTransitAndOptionalWake } = await import('./timeCareExecute');
      const exec = await executeTransitAndOptionalWake(t, {
        forceWake: care.kind === 'compound_wake_transit',
      });
      if (exec) {
        const kind: EarlyJustDoItResult['kind'] =
          exec.kind === 'compound_wake_transit' || exec.kind === 'wake'
            ? 'wake'
            : exec.kind === 'transit_leave'
              ? 'transit'
              : exec.kind === 'timer'
                ? 'timer'
                : exec.kind === 'parking'
                  ? 'parking'
                  : exec.kind === 'reminder'
                    ? 'reminder'
                    : 'wake';
        return {
          kind,
          speech: exec.speech,
          bullets: exec.bullets,
          quickActions: exec.quickActions,
          cardTitle: exec.cardTitle,
        };
      }
    } catch {
      /* soft → fallback clock/remind */
    }
  }

  if (
    care?.kind === 'wake' ||
    care?.kind === 'timer' ||
    isClockIntent(t)
  ) {
    const clock = await prepareClockIntentFollowUp(t);
    if (clock) {
      return {
        kind: clock.kind,
        speech: clock.speech,
        bullets: clock.bullets,
        quickActions: clock.quickActions,
        cardTitle: clock.cardTitle,
      };
    }
  }

  if (isVolumeIntent(t)) {
    return runVolumeJustDoIt(t);
  }

  try {
    const { looksLikePlaylistRequest, buildSpotifySearchUrl } = require('../playlistService') as {
      looksLikePlaylistRequest: (s: string) => boolean;
      buildSpotifySearchUrl: (q: string) => string;
    };
    if (looksLikePlaylistRequest(t)) {
      const url = buildSpotifySearchUrl(t);
      return {
        kind: 'playlist',
        speech: 'Alles klar — ich öffne dir die Playlist-Suche.',
        bullets: ['Spotify-Suche'],
        quickActions: [
          {
            type: 'OPEN_URL',
            label: '🎵 Playlist',
            payload: { url },
          },
        ],
        cardTitle: 'Playlist',
      };
    }
  } catch {
    /* soft */
  }

  if (care?.kind === 'reminder' || userAsksRemind(t)) {
    const rem = await runReminderJustDoIt(t);
    if (rem) return rem;
  }

  const look = await runLookNearJustDoIt(t);
  if (look) return look;

  try {
    const { isPhoneChargeIntent, runPhoneChargeDiscovery } = await import(
      '../navigation/phoneChargeDiscovery'
    );
    if (isPhoneChargeIntent(t)) {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
        };
      };
      const lat = useFinnusStore.getState().lastGpsLat;
      const lng = useFinnusStore.getState().lastGpsLng;
      if (lat == null || lng == null) {
        return {
          kind: 'charge',
          speech:
            'GPS kurz an — dann such ich einen echten Powerbank-Automaten oder ein offenes Café zum Laden. Keine Fake-Tipps.',
          bullets: ['GPS nötig', 'Powerbank oder offenes Café'],
          quickActions: [],
          cardTitle: 'Handy laden',
        };
      }
      const charge = await runPhoneChargeDiscovery({
        origin: { lat, lng },
      });
      return {
        kind: 'charge',
        speech: charge.speech,
        bullets: (charge.visualBullets ?? []).slice(0, 2),
        quickActions: charge.quickActions,
        cardTitle: 'Handy laden',
      };
    }
  } catch {
    /* soft — fall through */
  }

  return null;
}

export function peekTtsVolumeMul(): number {
  return getUserTtsVolumeMul();
}

export function mixTtsVolume(base?: number | null): number {
  return applyUserTtsVolume(base);
}
