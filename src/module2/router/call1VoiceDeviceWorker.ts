/**
 * Voice-Settings + Device-Action (Travel-Mode) Worker.
 * Voice: Profile/Settings SSOT via systemAgent-Helfer.
 * Device: travelModeContext (bike/foot) — Ack für Call-2.
 */

import type { Module2ActionButton } from '../types';

export type VoiceDeviceResult = {
  ok: boolean;
  kind: 'voice' | 'device' | 'none';
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  promptBlock: string;
};

export function wantsVoiceSettings(text: string): boolean {
  try {
    const { wantsVoiceChange } = require('../agents/systemAgent') as {
      wantsVoiceChange: (s: string) => boolean;
    };
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!wantsVoiceChange(t)) return false;
    // Hilfe/Erklärung nicht als Stimme-Umschalter
    if (
      /\b(was\s+ist|wozu|erkl[aä]r|hilfe|wie\s+funktioniert)\b/iu.test(t) &&
      !/\b(stimme\s+(?:von|auf|zu|um)|sprich\s+wie|stimme\s+ändern|stimme\s+aendern)\b/iu.test(
        t,
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return /\b(stimme|voice|sprich\s+wie|sprecher(?:in)?)\b/iu.test(text || '');
  }
}

export function wantsDeviceTravelMode(text: string): boolean {
  const t = (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ß/g, 'ss');
  if (!t) return false;
  // Pure Heuristik (Smoke/Node) — ß→ss wegen \b
  if (
    /\b(ich\s+bin\s+)?(mit\s+dem\s+)?(fahrrad|rad|bike|e-?bike)\b/i.test(t) ||
    /\b(fahr|fahre|radel)\s+(mit\s+dem\s+)?(rad|fahrrad|bike)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(zu\s+fuss|zu\s*fuss|laufend)\b/i.test(t) ||
    /\bich\s+(geh|gehe|laufe|lauf)\s+(zu\s+fuss|jetzt)\b/i.test(t)
  ) {
    return true;
  }
  try {
    const {
      detectTravelModeVoiceOverride,
    } = require('../../services/navigation/travelModeContext') as {
      detectTravelModeVoiceOverride: (s: string) => 'bike' | 'foot' | null;
    };
    return detectTravelModeVoiceOverride(text) != null;
  } catch {
    return false;
  }
}

export async function researchVoiceSettings(opts: {
  userText: string;
  signal?: AbortSignal;
}): Promise<VoiceDeviceResult> {
  if (opts.signal?.aborted) {
    return {
      ok: false,
      kind: 'voice',
      spokenDraft: 'FAKTEN Voice: abgebrochen.',
      bullets: [],
      buttons: [],
      promptBlock: 'aborted',
    };
  }

  try {
    const {
      matchVoiceId,
      wantsVoiceChange,
    } = require('../agents/systemAgent') as {
      matchVoiceId: (s: string) => string | null;
      wantsVoiceChange: (s: string) => boolean;
    };
    const { CARTESIA_VOICES } = require('../../constants/cartesiaVoices') as {
      CARTESIA_VOICES: Array<{ id: string; name: string; emoji?: string }>;
    };
    const { updateUserProfile } = require('../../services/userProfileService') as {
      updateUserProfile: (p: Record<string, unknown>) => Promise<unknown>;
    };
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          requestOpenSettings: (f?: 'voice' | 'mic' | null) => void;
        };
      };
    };

    const text = opts.userText;
    if (!wantsVoiceChange(text)) {
      return {
        ok: false,
        kind: 'none',
        spokenDraft: '',
        bullets: [],
        buttons: [],
        promptBlock: '',
      };
    }

    const voiceId = matchVoiceId(text);
    const settingsBtn: Module2ActionButton = {
      id: 'open_settings',
      label: '⚙️ Einstellungen',
      payload: { kind: 'ui', action: 'open_settings' },
    };
    const pickButtons: Module2ActionButton[] = CARTESIA_VOICES.slice(0, 6).map(
      (v) => ({
        id: `voice_${v.id}`,
        label: `${v.emoji ?? ''} ${v.name}`.trim().slice(0, 20),
        payload: {
          kind: 'ui' as const,
          action: 'set_voice',
          data: { voiceId: v.id, name: v.name },
        },
      }),
    );

    if (voiceId) {
      await updateUserProfile({ voiceId, ttsProvider: 'cartesia' });
      const name =
        CARTESIA_VOICES.find((v) => v.id === voiceId)?.name ?? voiceId;
      const spokenDraft = [
        `FAKTEN Voice: Stimme auf ${name} (${voiceId}) umgestellt.`,
        'FLOW: kurz bestätigen — sofort aktiv. Kein Extra-Menü-Vortrag.',
      ].join('\n');
      return {
        ok: true,
        kind: 'voice',
        spokenDraft,
        bullets: [`Stimme: ${name}`, 'Sofort aktiv'],
        buttons: [settingsBtn],
        promptBlock: spokenDraft,
      };
    }

    useFinnusStore.getState().requestOpenSettings('voice');
    const spokenDraft = [
      'FAKTEN Voice: Stimme ändern ohne Namen — Settings Voice geöffnet.',
      'FLOW: Tipps „Stimme von Alina“ oder Tippen; Buttons anbieten.',
    ].join('\n');
    return {
      ok: true,
      kind: 'voice',
      spokenDraft,
      bullets: ['Stimme wählen', 'Einstellungen'],
      buttons: [...pickButtons, settingsBtn],
      promptBlock: spokenDraft,
    };
  } catch {
    const spokenDraft = [
      'FAKTEN Voice: Umschalten fehlgeschlagen.',
      'FLOW: Einstellungen → Stimme anbieten. Nichts erfinden.',
    ].join('\n');
    return {
      ok: false,
      kind: 'voice',
      spokenDraft,
      bullets: ['Stimme'],
      buttons: [
        {
          id: 'open_settings',
          label: '⚙️ Einstellungen',
          payload: { kind: 'ui', action: 'open_settings' },
        },
      ],
      promptBlock: spokenDraft,
    };
  }
}

export async function researchDeviceTravelMode(opts: {
  userText: string;
  signal?: AbortSignal;
}): Promise<VoiceDeviceResult> {
  if (opts.signal?.aborted) {
    return {
      ok: false,
      kind: 'device',
      spokenDraft: 'FAKTEN Device: abgebrochen.',
      bullets: [],
      buttons: [],
      promptBlock: 'aborted',
    };
  }

  try {
    const {
      detectTravelModeVoiceOverride,
      forceBikeModeFromVoice,
      setPreferredTravelMode,
    } = require('../../services/navigation/travelModeContext') as {
      detectTravelModeVoiceOverride: (s: string) => 'bike' | 'foot' | null;
      forceBikeModeFromVoice: () => void;
      setPreferredTravelMode: (m: 'bike' | 'foot' | null) => void;
    };
    const mode = detectTravelModeVoiceOverride(opts.userText);
    if (!mode) {
      return {
        ok: false,
        kind: 'none',
        spokenDraft: '',
        bullets: [],
        buttons: [],
        promptBlock: '',
      };
    }
    if (mode === 'bike') forceBikeModeFromVoice();
    else setPreferredTravelMode('foot');

    const label = mode === 'bike' ? 'Fahrrad' : 'zu Fuß';
    const spokenDraft = [
      `FAKTEN Device: Travel-Mode → ${mode} (${label}).`,
      'FLOW: kurz bestätigen; Route/ETA im gewählten Modus. Kein zweites Mode-Menü.',
    ].join('\n');
    return {
      ok: true,
      kind: 'device',
      spokenDraft,
      bullets: [`Modus: ${label}`],
      buttons: [
        {
          id: 'switch_nav_mode',
          label: mode === 'bike' ? '🚲 Rad-Modus' : '🚶 Fuß-Modus',
          payload: {
            kind: 'switch_nav_mode',
            preferBike: mode === 'bike',
            preferWalk: mode === 'foot',
          },
        },
      ],
      promptBlock: spokenDraft,
    };
  } catch {
    const spokenDraft = [
      'FAKTEN Device: Mode-Switch fehlgeschlagen.',
      'FLOW: ehrlich — User kann in Settings Modus setzen.',
    ].join('\n');
    return {
      ok: false,
      kind: 'device',
      spokenDraft,
      bullets: [],
      buttons: [],
      promptBlock: spokenDraft,
    };
  }
}
