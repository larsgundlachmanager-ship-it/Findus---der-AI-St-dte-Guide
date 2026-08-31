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
      'Um dir an den richtigen Orten automatisch die passenden Audio-Spuren abzuspielen, erfasst Yorro deinen Standort.\n\n' +
      'Solange die App läuft oder im Hintergrund ist (auch bei gesperrtem Display), bleibt der Standort aktiv. Wenn du die App beendest, stoppt der Standortzugriff.',
  },
  background: {
    title: 'Standort im Hintergrund',
    body:
      'Yorro erfasst deinen Standort im Hintergrund und bei gesperrtem Bildschirm, solange die App noch läuft — für Navigation und Orts-Audio unterwegs.\n\n' +
      'Beendest du die App (aus den letzten Apps wischen), wird der Standortzugriff gestoppt.\n\n' +
      'Bitte wähle als Nächstes „Immer zulassen“, damit das bei gesperrtem Display weiterlaufen kann.',
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
