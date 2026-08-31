/**
 * Action-Buttons: Affiliate > Maps; Gastro Maps+Menü; etc.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import type { PitchKind, PitchOptionCard } from './types';

function label(s: string): string {
  return shortenActionLabel(s, 28);
}

export function buildPitchActions(opts: {
  kind: PitchKind;
  name: string;
  lat: number;
  lng: number;
  mapsUrl: string;
  menuUrl?: string | null;
  bookingUrl?: string | null;
  ticketUrl?: string | null;
  websiteUrl?: string | null;
  role?: 'favorite' | 'alternative' | 'out_of_box';
  /** Planung: keine Route-Buttons — nur Speisekarte/Maps/Buchung */
  suppressNav?: boolean;
  /** Optional: z. B. „Programm“ statt „Website“ bei Events */
  websiteLabel?: string | null;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  const medal =
    opts.role === 'favorite' ? '🥇' : opts.role === 'alternative' ? '🥈' : '✨';
  const suppressNav =
    Boolean(opts.suppressNav) ||
    (() => {
      try {
        const { isAlreadyAtCoords } = require('./navActionPolicy') as {
          isAlreadyAtCoords: (lat?: number | null, lng?: number | null) => boolean;
        };
        return isAlreadyAtCoords(opts.lat, opts.lng);
      } catch {
        return false;
      }
    })();

  if (opts.kind === 'hotel' && opts.bookingUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: label('🏨 Zimmer buchen'),
      payload: { url: opts.bookingUrl, destName: opts.name },
    });
    if (!suppressNav) {
      actions.push({
        type: 'START_NAVIGATION',
        label: label(`📍 ${opts.name}`),
        payload: {
          destName: opts.name,
          destLat: opts.lat,
          destLng: opts.lng,
        },
      });
    }
    return actions.slice(0, 5);
  }

  if (opts.ticketUrl) {
    const tasting = /weinprobe|verkostung|probe|confetti|konfetti/i.test(
      `${opts.name} ${opts.ticketUrl}`,
    );
    actions.push({
      type: 'OPEN_URL',
      label: label(tasting ? `${medal} Probe buchen` : `${medal} Ticket`),
      payload: { url: opts.ticketUrl, destName: opts.name },
    });
  }

  const isFood = opts.kind === 'food' || opts.kind === 'bar';
  const mapsUrl = (opts.mapsUrl || '').trim();
  const mapsOk =
    Boolean(mapsUrl) &&
    /^https?:\/\//i.test(mapsUrl) &&
    (() => {
      try {
        const { isEstablishedGoogleMapsPlaceUrl } = require('../../services/research/eventInfoUrl') as {
          isEstablishedGoogleMapsPlaceUrl: (
            u: string | null | undefined,
          ) => boolean;
        };
        return isEstablishedGoogleMapsPlaceUrl(mapsUrl);
      } catch {
        return false;
      }
    })();

  if (isFood && opts.menuUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: label(opts.kind === 'bar' ? '🍹 Karte' : '🍽 Speisekarte'),
      payload: { url: opts.menuUrl, destName: opts.name },
    });
  }

  if (!(opts.kind === 'hotel' && opts.bookingUrl) && mapsOk) {
    actions.push({
      type: 'OPEN_URL',
      label: label('🗺️ Maps'),
      payload: { url: mapsUrl, destName: opts.name },
    });
  }

  if (
    opts.websiteUrl &&
    opts.websiteUrl !== opts.ticketUrl &&
    !(isFood && opts.menuUrl)
  ) {
    actions.push({
      type: 'OPEN_URL',
      label: label(
        opts.websiteLabel?.trim() ||
          (opts.kind === 'cinema' ? '🌐 Programm' : '🌐 Website'),
      ),
      payload: { url: opts.websiteUrl, destName: opts.name },
    });
  }

  // In-App-Route für Auto-Start nach Tap — UI blendet sie vor der Wahl aus
  if (!(opts.kind === 'hotel' && opts.bookingUrl) && !suppressNav) {
    let addStop = false;
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      addStop = useFinnusStore.getState().navActive === true;
    } catch {
      addStop = false;
    }
    actions.push({
      type: 'START_NAVIGATION',
      label: label(addStop ? '➕ Stopp hinzufügen' : '📍 Navigation starten'),
      payload: {
        destName: opts.name,
        destLat: opts.lat,
        destLng: opts.lng,
        skipDestVerify: true,
        skipClosingGate: true,
        ...(addStop ? { addStop: true } : {}),
      },
    });
  }

  if (
    opts.kind === 'cinema' &&
    opts.websiteUrl &&
    !actions.some((a) => a.payload.url === opts.websiteUrl)
  ) {
    actions.push({
      type: 'OPEN_URL',
      label: label('🌐 Programm'),
      payload: { url: opts.websiteUrl, destName: opts.name },
    });
  }

  if (!actions.length && !suppressNav) {
    actions.push({
      type: 'START_NAVIGATION',
      label: label('📍 Navigation starten'),
      payload: {
        destName: opts.name,
        destLat: opts.lat,
        destLng: opts.lng,
      },
    });
  }

  return actions.slice(0, 5);
}

function isNavStartAction(a: QuickAction): boolean {
  return a.type === 'START_NAVIGATION';
}

function looksLikeMapsOpen(a: QuickAction): boolean {
  if (a.type !== 'OPEN_URL') return false;
  return /maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl|🗺️/i.test(
    `${a.label} ${a.payload?.url ?? ''}`,
  );
}

function isEstablishedMapsAction(a: QuickAction): boolean {
  if (!looksLikeMapsOpen(a)) return false;
  const url = String(a.payload?.url ?? '').trim();
  if (!url) return false;
  try {
    const { isEstablishedGoogleMapsPlaceUrl } = require('../../services/research/eventInfoUrl') as {
      isEstablishedGoogleMapsPlaceUrl: (u: string | null | undefined) => boolean;
    };
    return isEstablishedGoogleMapsPlaceUrl(url);
  } catch {
    return false;
  }
}

export function buildPitchRouteAction(opts: {
  name: string;
  lat: number;
  lng: number;
}): QuickAction | null {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) return null;
  if (opts.lat === 0 && opts.lng === 0) return null;
  return {
    type: 'START_NAVIGATION',
    label: label('📍 Navigation starten'),
    payload: {
      destName: opts.name,
      destLat: opts.lat,
      destLng: opts.lng,
      // User hat die Option schon gewählt — keine Fernziel-/Gate-Schleife
      skipDestVerify: true,
      skipClosingGate: true,
    },
  };
}

/** Vor der Wahl: Speisekarte/Maps/Web. Nach Tap: kein extra Route-Button wenn Nav schon läuft. */
export function pitchChoiceVisibleActions(
  option: {
    name: string;
    lat: number;
    lng: number;
    actions?: QuickAction[] | null;
    showNavBeforeSelect?: boolean;
  },
  selected: boolean,
): QuickAction[] {
  const raw = option.actions ?? [];
  const links = raw.filter(
    (a) => !isNavStartAction(a) && !looksLikeMapsOpen(a),
  );
  const maps = raw.find((a) => isEstablishedMapsAction(a));
  const out = [...links];
  if (
    maps?.payload?.url &&
    !out.some((a) => a.payload?.url === maps.payload?.url)
  ) {
    out.push({ ...maps, label: label('🗺️ Maps') });
  }

  let navActive = false;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    navActive = Boolean(useFinnusStore.getState().navActive);
  } catch {
    navActive = false;
  }

  if ((selected || option.showNavBeforeSelect) && !navActive) {
    const existingNav = raw.find((a) => a.type === 'START_NAVIGATION');
    const keepIntent = Boolean(
      existingNav?.payload?.preferWalk ||
        existingNav?.payload?.preferTransit ||
        existingNav?.payload?.preferBike ||
        existingNav?.payload?.journeyNav,
    );
    const navLat =
      typeof existingNav?.payload?.destLat === 'number'
        ? existingNav.payload.destLat
        : option.lat;
    const navLng =
      typeof existingNav?.payload?.destLng === 'number'
        ? existingNav.payload.destLng
        : option.lng;
    const nav =
      keepIntent && existingNav
        ? {
            ...existingNav,
            payload: {
              ...existingNav.payload,
              destName: existingNav.payload.destName || option.name,
              skipDestVerify: true,
              skipClosingGate: true,
            },
          }
        : buildPitchRouteAction({
            name: option.name,
            lat: navLat,
            lng: navLng,
          }) ||
          (existingNav && existingNav.payload
            ? {
                ...existingNav,
                label: label('📍 Navigation starten'),
                payload: {
                  ...existingNav.payload,
                  destName: existingNav.payload.destName || option.name,
                  skipDestVerify: true,
                  skipClosingGate: true,
                },
              }
            : null);
    if (nav && !out.some((a) => a.type === 'START_NAVIGATION')) {
      out.push({
        ...nav,
        label: label('📍 Navigation starten'),
      });
    }
  }
  return out.slice(0, 5);
}

export function mergeActionUpdates(
  card: PitchOptionCard,
  patch: Partial<PitchOptionCard>,
): PitchOptionCard {
  return {
    ...card,
    ...patch,
    actions: patch.actions ?? card.actions,
    bullets: patch.bullets ?? card.bullets,
  };
}
