from pathlib import Path

# --- permissionAlerts.ts ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\utils\permissionAlerts.ts")
text = p.read_text(encoding="utf-8")

old_copy = '''  audioConsent: {
    title: 'Mikrofon-Einwilligung fehlt',
    message:
      'Spracheingabe ist aus oder noch nicht bestätigt. Tippe „Zu den Einstellungen“, aktiviere „Sprache an“ unter Allgemeine Einstellungen → Audio & Sparmodus — danach hören Halten, Fixieren und Live-Chat wieder.',
    openSettings: false,
  },'''

new_copy = '''  audioConsent: {
    title: 'Spracheingabe ist aus',
    message:
      'Yorro darf dich noch nicht hören. Tippe „Jetzt einstellen“ — ich öffne direkt Allgemeine Einstellungen → Audio & Sparmodus. Dort „Sprache an“ wählen, dann geht’s weiter.',
    openSettings: false,
  },'''

if old_copy not in text:
    raise SystemExit('copy missing')
text = text.replace(old_copy, new_copy, 1)

# Replace the open settings helper usage — rewrite bottom of file
marker = '''/** Ein Popup für fehlende In-App-Mikrofon-Einwilligung (kein zweites Tippfeld parallel). */
export function showAudioConsentMissingAlert(options?: {
  force?: boolean;
  onTypeAsk?: () => void;
}): void {
  showPermissionMissingAlert('audioConsent', {
    force: options?.force ?? true,
    onTypeAsk: options?.onTypeAsk,
    onOpenInAppSettings: () => {
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
    },
  });
}'''

helper = '''/**
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
}'''

if marker not in text:
    raise SystemExit('marker missing')
text = text.replace(marker, helper, 1)

# Also fix fallback button text and use helper
text = text.replace(
    "text: 'Zu den Einstellungen',",
    "text: 'Jetzt einstellen',",
)
# fallback without callback should also use helper
old_fb = '''  } else if (kind === 'audioConsent') {
    // Fallback ohne Callback: trotzdem in-App Settings ansteuern
    buttons.push({
      text: 'Jetzt einstellen',
      onPress: () => {
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
      },
    });
  }'''

new_fb = '''  } else if (kind === 'audioConsent') {
    buttons.push({
      text: 'Jetzt einstellen',
      onPress: () => {
        openInAppMicConsentSettings({ reopenReisebuero: true });
      },
    });
  }'''

if old_fb not in text:
    raise SystemExit('fallback missing')
text = text.replace(old_fb, new_fb, 1)

# Problem: openInAppMicConsentSettings is used before defined in showPermissionMissingAlert
# Need to move helper ABOVE showPermissionMissingAlert
# Re-read and restructure file properly
p.write_text(text, encoding='utf-8')
print('permissionAlerts first pass ok')
