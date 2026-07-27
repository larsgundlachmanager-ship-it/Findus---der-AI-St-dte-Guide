/**
 * Einheitliche Popups, wenn System-Berechtigungen fehlen.
 */

import { Alert, Linking } from 'react-native';

export type PermissionAlertKind =
  | 'location'
  | 'locationServices'
  | 'microphone'
  | 'speechUnavailable'
  | 'audioConsent';

const COPY: Record<
  PermissionAlertKind,
  { title: string; message: string; openSettings: boolean }
> = {
  location: {
    title: 'Standort-Berechtigung fehlt',
    message:
      'Findus braucht deinen Standort, um Sehenswürdigkeiten zu erkennen und dich zu navigieren. Bitte erlaube den Zugriff.',
    openSettings: true,
  },
  locationServices: {
    title: 'Standort-Dienste aus',
    message:
      'Am Gerät sind die Standort-Dienste deaktiviert. Bitte schalte sie ein, damit Findus Orte in der Nähe finden kann.',
    openSettings: true,
  },
  microphone: {
    title: 'Mikrofon-Berechtigung fehlt',
    message:
      'Ohne Mikrofon-Zugriff kann Findus dich nicht hören. Bitte erlaube das Mikrofon in den Systemeinstellungen.',
    openSettings: true,
  },
  speechUnavailable: {
    title: 'Spracherkennung nicht verfügbar',
    message:
      'Auf dem Gerät wurde kein Spracherkennungsdienst gefunden. Bitte prüfe die Google App bzw. „Speech Services by Google“ und erlaube ggf. die Berechtigungen.',
    openSettings: true,
  },
  audioConsent: {
    title: 'Mikrofon-Einwilligung fehlt',
    message:
      'Bitte bestätige unter Einstellungen → Einrichtung → Datenschutz & Mikrofon, dass Spracheingaben verarbeitet werden dürfen.',
    openSettings: false,
  },
};

const lastShownAt: Partial<Record<PermissionAlertKind, number>> = {};
const DEBOUNCE_MS = 2800;

/**
 * Zeigt immer ein Alert, wenn eine Berechtigung fehlt.
 * Debounce verhindert Doppel-Popups bei parallelen Requests.
 */
export function showPermissionMissingAlert(
  kind: PermissionAlertKind,
  options?: { force?: boolean },
): void {
  const now = Date.now();
  if (
    !options?.force &&
    lastShownAt[kind] != null &&
    now - (lastShownAt[kind] as number) < DEBOUNCE_MS
  ) {
    return;
  }
  lastShownAt[kind] = now;

  const copy = COPY[kind];
  const buttons = copy.openSettings
    ? [
        { text: 'Später', style: 'cancel' as const },
        {
          text: 'Einstellungen öffnen',
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ]
    : [{ text: 'OK' }];

  Alert.alert(copy.title, copy.message, buttons);
}
