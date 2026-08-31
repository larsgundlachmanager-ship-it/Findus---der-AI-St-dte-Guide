/**
 * Hands-free Setup per Sprache: Android-Fähigkeiten prüfen → anbieten → auf Bestätigung ausführen.
 */

import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Module2ActionButton } from '../../module2/types';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
  patchHandsFreePrefs,
} from './handsFreePrefs';
import { syncHandsFreeListenNotification } from './handsFreeNotification';
import { openDigitalAssistantSettings } from './handsFreeLinking';

type NativeHandsFree = {
  getCapabilities?: () => Promise<{
    pinShortcutSupported?: boolean;
    hasStaticListenShortcut?: boolean;
  }>;
  requestPinListenShortcut?: () => Promise<boolean>;
};

const Native = NativeModules.FindusHandsFree as NativeHandsFree | undefined;

export type HandsFreeCapabilityReport = {
  platform: string;
  stickyNotificationPrefOn: boolean;
  notificationPermission: 'granted' | 'denied' | 'undetermined';
  pinShortcutSupported: boolean;
  hasLauncherLongPressShortcut: boolean;
  canOpenAssistantSettings: boolean;
  /** Power-/Gemini-Taste kann die App nicht ersetzen */
  powerButtonReplaceable: false;
};

export function wantsHandsFreeSetup(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(shortcut|short\s*cut|schnellzugriff|home[- ]?shortcut)\b/i.test(t) ||
    /\b(hands[-\s]?free|handsfree)\b/i.test(t) ||
    /\b(sprechen[- ]?notification|mikro(?:fon)?[- ]?(?:shortcut|taste|button))\b/i.test(
      t,
    ) ||
    /\b((?:yorro|findus)\s+aktivier|mikro\s+aktivier|leichter\s+ansprechen)\b/i.test(t) ||
    /\b(power[- ]?taste|gemini|assistent(?:en)?[- ]?(?:taste|einstellung))\b/i.test(
      t,
    )
  );
}

export function wantsEnableSpeakNotification(text: string): boolean {
  return (
    /\b(sprechen[- ]?notification|sticky[- ]?notification|benachrichtigung)\b/i.test(
      text,
    ) &&
    /\b(an|ein|aktiv|einschalt|schick|mach|ja)\b/i.test(text)
  );
}

export function wantsPinHomeShortcut(text: string): boolean {
  return (
    /\b(home[- ]?shortcut|shortcut\s+(?:legen|pin|erstell|auf\s+den\s+homescreen)|homescreen)\b/i.test(
      text,
    ) && /\b(ja|legen|pin|mach|erstell|bitte|aktivier)\b/i.test(text)
  );
}

export function wantsOpenAssistantSettings(text: string): boolean {
  return /\b(assistent(?:en)?[- ]?einstellung|digitale[rn]?\s+assistent|gemini\s+umstell)\b/i.test(
    text,
  );
}

export async function probeHandsFreeCapabilities(): Promise<HandsFreeCapabilityReport> {
  await loadHandsFreePrefs();
  const prefs = getHandsFreePrefsSync();
  let notificationPermission: HandsFreeCapabilityReport['notificationPermission'] =
    'undetermined';
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) notificationPermission = 'granted';
    else if (perm.status === 'denied') notificationPermission = 'denied';
  } catch {
    /* soft */
  }

  let pinShortcutSupported = false;
  let hasLauncherLongPressShortcut = Platform.OS === 'android';
  if (Platform.OS === 'android' && Native?.getCapabilities) {
    try {
      const cap = await Native.getCapabilities();
      pinShortcutSupported = cap.pinShortcutSupported === true;
      hasLauncherLongPressShortcut = cap.hasStaticListenShortcut !== false;
    } catch {
      pinShortcutSupported = false;
    }
  }

  return {
    platform: Platform.OS,
    stickyNotificationPrefOn: prefs.stickyListenNotification,
    notificationPermission,
    pinShortcutSupported,
    hasLauncherLongPressShortcut,
    canOpenAssistantSettings: Platform.OS === 'android',
    powerButtonReplaceable: false,
  };
}

export async function enableSpeakNotification(): Promise<{
  ok: boolean;
  message: string;
}> {
  await patchHandsFreePrefs({ stickyListenNotification: true });
  await syncHandsFreeListenNotification();
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) {
    const req = await Notifications.requestPermissionsAsync();
    if (!req.granted) {
      return {
        ok: false,
        message:
          'Notification-Recht fehlt noch — bitte unter System → Apps → Yorro erlauben, dann sag nochmal „Notification an“.',
      };
    }
    await syncHandsFreeListenNotification();
  }
  return {
    ok: true,
    message:
      'Passt — „Yorro bereit“ mit dem Button „Sprechen“ liegt jetzt in den Notifications. Tippen startet das Mikro hands-free, auch vom Sperrbildschirm.',
  };
}

export async function pinListenHomeShortcut(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (Platform.OS !== 'android' || !Native?.requestPinListenShortcut) {
    return {
      ok: false,
      message:
        'Home-Shortcut-Pin geht hier nicht — App-Icon lange drücken und „Sprechen“ ablegen, oder die Sprechen-Notification nutzen.',
    };
  }
  try {
    const ok = await Native.requestPinListenShortcut();
    if (!ok) {
      return {
        ok: false,
        message:
          'Dein Launcher lässt kein automatisches Anpinnen zu. Lang aufs Yorro-Icon drücken → „Sprechen“ auf den Homescreen ziehen.',
      };
    }
    return {
      ok: true,
      message:
        'Android fragt jetzt nach — wenn du bestätigst, liegt „Sprechen“ als Shortcut auf dem Homescreen und startet direkt das Mikro.',
    };
  } catch {
    return {
      ok: false,
      message:
        'Shortcut konnte ich nicht anstoßen. Versuch: App-Icon lange drücken → „Sprechen“.',
    };
  }
}

function promptButton(id: string, label: string, prompt: string): Module2ActionButton {
  return {
    id,
    label: label.slice(0, 20),
    payload: { kind: 'ui', action: 'prompt', data: { prompt } },
  };
}

/** Angebot: was Android zulässt + Bestätigungs-Buttons. */
export function buildHandsFreeOffer(report: HandsFreeCapabilityReport): {
  draftText: string;
  bullets: string[];
  buttons: Module2ActionButton[];
} {
  const lines: string[] = [];
  const bullets: string[] = [];
  const buttons: Module2ActionButton[] = [];

  lines.push(
    'Kurz der Stand, was dein Handy für Hands-free hergibt — und was ich dir anbieten kann.',
  );

  if (report.stickyNotificationPrefOn && report.notificationPermission === 'granted') {
    bullets.push('Notification „Sprechen“ ist schon an');
  } else if (report.notificationPermission === 'denied') {
    bullets.push('Notification: Systemrecht fehlt');
    lines.push(
      'Die Sprechen-Notification wäre der zuverlässigste Weg auch bei gesperrtem Display — dafür brauchst du einmal die Notification-Erlaubnis.',
    );
    buttons.push(
      promptButton(
        'hf_notif',
        'Notification an',
        'Ja, Sprechen-Notification einschalten',
      ),
    );
  } else {
    bullets.push(
      report.stickyNotificationPrefOn
        ? 'Notification: Recht prüfen'
        : 'Notification „Sprechen“ möglich',
    );
    lines.push(
      'Ich kann eine feste Notification „Yorro bereit“ mit dem Button „Sprechen“ legen — Tippen startet das Mikro, auch vom Sperrbildschirm.',
    );
    buttons.push(
      promptButton(
        'hf_notif',
        'Notification an',
        'Ja, Sprechen-Notification einschalten',
      ),
    );
  }

  if (report.pinShortcutSupported) {
    bullets.push('Home-Shortcut pinbar');
    lines.push(
      'Außerdem kann ich dir einen Homescreen-Shortcut „Sprechen“ anbieten — Android fragt zur Bestätigung.',
    );
    buttons.push(
      promptButton(
        'hf_pin',
        'Shortcut legen',
        'Ja, Home-Shortcut für Mikro legen',
      ),
    );
  } else if (report.hasLauncherLongPressShortcut) {
    bullets.push('Icon lang drücken → Sprechen');
    lines.push(
      'Automatisches Anpinnen geht auf dem Launcher nicht — aber: Yorro-Icon lange drücken, „Sprechen“ erscheint und kannst du auf den Homescreen legen.',
    );
  }

  if (report.canOpenAssistantSettings) {
    bullets.push('Assistenten-Einstellungen');
    lines.push(
      'Die Power-Taste bzw. Gemini kann ich nicht einfach überschreiben — in den Assistenten-Einstellungen siehst du, was Android zulässt.',
    );
    buttons.push(
      promptButton(
        'hf_assist',
        'Assistent öffnen',
        'Assistenten-Einstellungen öffnen',
      ),
    );
  }

  lines.push('Sag einfach ja zu einer Option, oder tipp den Button.');

  buttons.push({
    id: 'open_settings',
    label: '⚙️ Einstellungen',
    payload: {
      kind: 'ui',
      action: 'prompt',
      data: { prompt: '__OPEN_APP_SETTINGS__' },
    },
  });

  return {
    draftText: lines.join(' '),
    bullets: bullets.slice(0, 4),
    buttons: buttons.slice(0, 4),
  };
}

/** Bestätigung / Direktbefehl ausführen. */
export async function tryExecuteHandsFreeCommand(
  text: string,
): Promise<{ draftText: string; bullets: string[] } | null> {
  if (wantsEnableSpeakNotification(text)) {
    const r = await enableSpeakNotification();
    return {
      draftText: r.message,
      bullets: [r.ok ? 'Notification an' : 'Recht fehlt'],
    };
  }
  if (wantsPinHomeShortcut(text)) {
    const r = await pinListenHomeShortcut();
    return {
      draftText: r.message,
      bullets: [r.ok ? 'Shortcut-Dialog' : 'Manuell legen'],
    };
  }
  if (wantsOpenAssistantSettings(text)) {
    await openDigitalAssistantSettings();
    return {
      draftText:
        'Ich öffne die Assistenten-Einstellungen. Power-/Gemini-Taste steuert Android — dort kannst du schauen, was geht.',
      bullets: ['Assistenten-Einstellungen'],
    };
  }
  return null;
}
