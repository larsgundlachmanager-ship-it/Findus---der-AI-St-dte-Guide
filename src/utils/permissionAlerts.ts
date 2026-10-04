/**
 * Einheitliche Popups, wenn System-Berechtigungen fehlen.
 */

import { Alert, Linking } from 'react-native';

export type PermissionAlertKind =
  | 'location'
  | 'locationServices'
  | 'microphone'
  | 'speechUnavailable'
  | 'audioConsent'
  | 'notifications';

export type PermissionAlertOptions = {
  force?: boolean;
  /** In-App Settings (z. B. Mikrofon-Einwilligung) statt System-Settings. */
  onOpenInAppSettings?: () => void;
  /** Optional: Tippfeld öffnen — ohne zweites Modal parallel. */
  onTypeAsk?: () => void;
};

const COPY: Record<
  PermissionAlertKind,
  { title: string; message: string; openSettings: boolean }
> = {
  location: {
    title: 'Standort-Berechtigung',
    message:
      'Yorro braucht deinen Standort für Orte in der Nähe und Navigation. Bitte erlauben — danach kannst du „Immer zulassen“ direkt im System-Dialog tippen.',
    openSettings: true,
  },
  locationServices: {
    title: 'Standort-Dienste aus',
    message:
      'Am Gerät sind die Standort-Dienste deaktiviert. Bitte schalte sie ein, damit Yorro Orte in der Nähe finden, Navigationshinweise geben und Trigger rechtzeitig erkennen kann.',
    openSettings: true,
  },
  microphone: {
    title: 'Mikrofon-Berechtigung fehlt',
    message:
      'Ohne Mikrofon-Zugriff kann Yorro dich nicht hören. Bitte erlaube das Mikrofon in den Systemeinstellungen.',
    openSettings: true,
  },
  speechUnavailable: {
    title: 'Spracherkennung nicht verfügbar',
    message:
      'Auf dem Gerät wurde kein Spracherkennungsdienst gefunden. Bitte prüfe die Google App bzw. „Speech Services by Google“ und erlaube ggf. die Berechtigungen.',
    openSettings: true,
  },
  audioConsent: {
    title: 'Spracheingabe ist aus',
    message:
      'Yorro darf dich noch nicht hören. Tippe „Jetzt einstellen“ — ich öffne direkt Allgemeine Einstellungen → Audio & Sparmodus. Dort „Sprache an“ wählen, dann geht’s weiter.',
    openSettings: false,
  },
  notifications: {
    title: 'Benachrichtigungen fehlen',
    message:
      'Damit Yorro dich rechtzeitig zum Bus oder Flug erinnern oder wecken kann — auch bei gesperrtem Bildschirm — bitte Benachrichtigungen erlauben.',
    openSettings: true,
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
  options?: PermissionAlertOptions,
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
  const buttons: {
    text: string;
    style?: 'cancel' | 'destructive' | 'default';
    onPress?: () => void;
  }[] = [{ text: 'Später', style: 'cancel' }];

  if (options?.onTypeAsk) {
    buttons.push({
      text: 'Frage tippen',
      onPress: () => {
        options.onTypeAsk?.();
      },
    });
  }

  if (kind === 'audioConsent' && options?.onOpenInAppSettings) {
    buttons.push({
      text: 'Jetzt einstellen',
      onPress: () => {
        options.onOpenInAppSettings?.();
      },
    });
  } else if (copy.openSettings) {
    buttons.push({
      text: 'Einstellungen öffnen',
      onPress: () => {
        void Linking.openSettings();
      },
    });
  } else if (kind === 'audioConsent') {
    buttons.push({
      text: 'Jetzt einstellen',
      onPress: () => {
        openInAppMicConsentSettings({ reopenReisebuero: true });
      },
    });
  }

  Alert.alert(copy.title, copy.message, buttons);
}

/**
 * Schließt blockierende Overlays (z. B. Reisebüro) und öffnet Settings
 * genau bei Audio & Sparmodus → „Sprache an“.
 */
export function openInAppMicConsentSettings(opts?: {
  /** Nach dem Speichern Reisebüro wieder öffnen */
  reopenReisebuero?: boolean;
}): void {
  try {
    const { useReisebueroStore } = require('../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          overlayOpen: boolean;
          closeOverlay: () => void;
          setReopenAfterMicConsent: (v: boolean) => void;
        };
      };
    };
    const rb = useReisebueroStore.getState();
    if (opts?.reopenReisebuero || rb.overlayOpen) {
      rb.setReopenAfterMicConsent(true);
    }
    if (rb.overlayOpen) rb.closeOverlay();
  } catch {
    /* soft */
  }
  try {
    const { useFinnusStore } = require('../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          requestOpenSettings: (focus?: 'voice' | 'mic' | null) => void;
        };
      };
    };
    useFinnusStore.getState().requestOpenSettings('mic');
  } catch {
    /* soft */
  }
}

/** Ein Popup für fehlende In-App-Mikrofon-Einwilligung (kein zweites Tippfeld parallel). */
export function showAudioConsentMissingAlert(options?: {
  force?: boolean;
  onTypeAsk?: () => void;
  reopenReisebuero?: boolean;
}): void {
  showPermissionMissingAlert('audioConsent', {
    force: options?.force ?? true,
    onTypeAsk: options?.onTypeAsk,
    onOpenInAppSettings: () => {
      openInAppMicConsentSettings({
        reopenReisebuero: options?.reopenReisebuero ?? true,
      });
    },
  });
}
