/**
 * Google Play — Prominent Disclosure vor Standort-Systemdialogen.
 * Muss VOR requestForeground/BackgroundPermissionsAsync erscheinen.
 */

import { Alert, Platform } from 'react-native';

export type LocationDisclosureKind = 'foreground' | 'background';

export type LocationDisclosureResult = 'accepted' | 'declined';

export type LocationDisclosurePresenter = (input: {
  kind: LocationDisclosureKind;
}) => Promise<LocationDisclosureResult>;

let presenter: LocationDisclosurePresenter | null = null;

/** Nach „Weiter“ kurz gültig — verhindert Doppel-Modal FG→BG in einem Flow. */
let lastAcceptedAtMs = 0;
const FRESH_ACCEPT_MS = 120_000;

export const LOCATION_DISCLOSURE_COPY = {
  foreground: {
    title: 'Standort für die Tour',
    body:
      'Um dir an den richtigen Orten automatisch die passenden Audio-Spuren abzuspielen, erfasst Findus deinen Standort.\n\n' +
      'Findus nutzt den Standort auch im Hintergrund — auch wenn die App geschlossen ist oder nicht genutzt wird —, damit Hinweise weiterlaufen, wenn das Display gesperrt ist.',
  },
  background: {
    title: 'Standort im Hintergrund',
    body:
      'Findus erfasst deine Standortdaten im Hintergrund, um automatische Audio-Hinweise entlang der Route abzuspielen, auch wenn die App geschlossen ist oder nicht genutzt wird.\n\n' +
      'Bitte wähle als Nächstes „Immer zulassen“, damit Navigation und Orts-Audio bei gesperrtem Bildschirm weiterlaufen.',
  },
} as const;

/** Vom Root-Modal registrieren (App.tsx). */
export function registerLocationDisclosurePresenter(
  next: LocationDisclosurePresenter | null,
): void {
  presenter = next;
}

export function markLocationDisclosureAccepted(): void {
  lastAcceptedAtMs = Date.now();
}

function disclosureStillFresh(): boolean {
  return (
    lastAcceptedAtMs > 0 && Date.now() - lastAcceptedAtMs < FRESH_ACCEPT_MS
  );
}

function presentViaAlert(
  kind: LocationDisclosureKind,
): Promise<LocationDisclosureResult> {
  const copy = LOCATION_DISCLOSURE_COPY[kind];
  return new Promise((resolve) => {
    Alert.alert(copy.title, copy.body, [
      {
        text: 'Nicht jetzt',
        style: 'cancel',
        onPress: () => resolve('declined'),
      },
      {
        text: 'Weiter',
        onPress: () => {
          markLocationDisclosureAccepted();
          resolve('accepted');
        },
      },
    ]);
  });
}

/**
 * Zeigt den App-eigenen Hinweis. true = User hat „Weiter“ gewählt.
 * Bereits erteilte Rechte → kein Dialog.
 */
export async function ensureLocationProminentDisclosure(
  kind: LocationDisclosureKind,
  opts?: { force?: boolean },
): Promise<boolean> {
  // iOS: gleicher Text, Dialog trotzdem sinnvoll vor Always-Ask
  void Platform;

  if (kind === 'foreground' && !opts?.force && disclosureStillFresh()) {
    return true;
  }
  // background: immer erneut zeigen — Google verlangt den Hinweis unmittelbar davor

  const result = presenter
    ? await presenter({ kind })
    : await presentViaAlert(kind);

  if (result === 'accepted') {
    markLocationDisclosureAccepted();
    return true;
  }
  return false;
}
