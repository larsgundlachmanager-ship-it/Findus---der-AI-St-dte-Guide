import type { Module2Agent } from './types';
import type { Module2ActionButton } from '../types';
import { CARTESIA_VOICES } from '../../constants/cartesiaVoices';
import {
  helpEntrySpeech,
  searchHelpEntries,
} from '../../constants/helpCatalog';
import { updateUserProfile } from '../../services/userProfileService';
import { parseUiScaleVoice } from '../../services/ui/uiScale';
import type { VoiceId } from '../../types/userProfile';
import { setFlashlight, toggleFlashlight } from '../../services/device/flashlight';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  buildHandsFreeOffer,
  probeHandsFreeCapabilities,
  tryExecuteHandsFreeCommand,
  wantsHandsFreeSetup,
} from '../../services/handsFree/handsFreeSetupAdvisor';
import {
  startLiveChatSession,
  stopLiveChatSession,
  wantsLiveChatVoiceCommand,
  wantsStopLiveChatVoiceCommand,
} from '../../services/handsFree/liveChatSession';

const VOICE_ALIASES: Record<string, VoiceId> = {
  jacqueline: 'jaqcline',
  jacquline: 'jaqcline',
  jackie: 'jaqcline',
  alex: 'alexander',
  viktoria: 'viktoria',
  victoria: 'viktoria',
};

function matchVoiceId(text: string): VoiceId | null {
  const t = text.toLowerCase();
  const ranked = [...CARTESIA_VOICES].sort(
    (a, b) => b.name.length - a.name.length || b.id.length - a.id.length,
  );
  for (const v of ranked) {
    const name = v.name.toLowerCase();
    const reName = new RegExp(`\\b${name}\\b`, 'i');
    const reId = new RegExp(`\\b${v.id}\\b`, 'i');
    if (reName.test(t) || reId.test(t)) return v.id;
  }
  for (const [alias, id] of Object.entries(VOICE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(t)) return id;
  }
  return null;
}

function wantsVoiceChange(text: string): boolean {
  return /\b(stimme|voice|sprich|reden|umschalten|sprecher(?:in)?)\b/i.test(
    text,
  );
}

/** Frage nach Erklärung / Hilfe — nicht sofort Stimme umschalten. */
function wantsSelfExplain(text: string): boolean {
  return (
    /\b(was kannst du|was kannst du alles|wer bist du|erkl[aä]r(?:e|t)?|anleitung|wie (?:ände|funktioniert|geht|nutze|mache|stell)|hilfe[- ]?(katalog|app|stimme|wecker|navigation|kalender|einstellung)?)\b/i.test(
      text,
    ) ||
    /\b(was ist|wozu|wofür)\b.+\b(findus|kalender|wecker|stimme|modul)\b/i.test(
      text,
    )
  );
}

function wantsFlashlight(text: string): 'on' | 'off' | 'toggle' | null {
  if (
    !/\b(taschenlampe|blitzlicht|flashlight|torch|licht\s*an|licht\s*aus)\b/i.test(
      text,
    )
  ) {
    return null;
  }
  if (/\b(aus|off|deaktiv|ausmachen|ausschalten)\b/i.test(text)) return 'off';
  if (/\b(an|ein|on|aktiv|anmachen|anschalten)\b/i.test(text)) return 'on';
  return 'toggle';
}

function wantsSettings(text: string): boolean {
  return /\b(einstellung|settings|menü|menu)\b/i.test(text);
}

function settingsButton(): Module2ActionButton {
  return {
    id: 'open_settings',
    label: '⚙️ Einstellungen',
    payload: { kind: 'ui', action: 'open_settings' },
  };
}

function voicePickButtons(): Module2ActionButton[] {
  return CARTESIA_VOICES.slice(0, 6).map((v) => ({
    id: `voice_${v.id}`,
    label: `${v.emoji} ${v.name}`.slice(0, 20),
    payload: {
      kind: 'ui' as const,
      action: 'set_voice',
      data: { voiceId: v.id, name: v.name },
    },
  }));
}

function overviewSpeech(): string {
  return (
    'Ich bin Findus — dein Reise-Concierge. Am Mikrofon fragst du mich alles: Essen, Route, Geschichte, Wetter, Wecker. ' +
    'An Wahrzeichen erzähle ich von allein. Oben rechts: Kalender für Timeline und Planung, Zahnrad für Einstellungen. ' +
    'Stimme ändern: sag „Stimme von Alina“ oder „Stimme ändern“. Wecker: „Wecker um sieben“. ' +
    'Frag jederzeit „Wie geht …?“ — ich erklär mich selbst.'
  );
}

export const systemAgent: Module2Agent = {
  id: 'system',
  intents: ['system'],
  async run({ task }) {
    const text = task.rewrittenText;
    const buttons: Module2ActionButton[] = [settingsButton()];

    // 0a) Live-Chat
    if (wantsStopLiveChatVoiceCommand(text)) {
      await stopLiveChatSession('voice');
      return {
        agent: 'system',
        ok: true,
        draftText: 'Live-Chat aus — Mikro ist wieder normal.',
        bullets: ['Live-Chat aus'],
        buttons,
        meta: { liveChat: 'stopped' },
      };
    }
    if (wantsLiveChatVoiceCommand(text)) {
      const started = await startLiveChatSession('voice');
      return {
        agent: 'system',
        ok: started.ok,
        draftText:
          started.message ??
          'Live-Chat konnte ich nicht starten — Mic-Berechtigung prüfen.',
        bullets: started.ok
          ? ['Mikro an', 'frei weiterreden', 'Idle → Mikro aus']
          : ['Live-Chat'],
        buttons: started.ok
          ? [
              {
                id: 'live_stop',
                label: 'Live-Chat aus',
                payload: {
                  kind: 'ui',
                  action: 'prompt',
                  data: { prompt: 'Live-Chat aus' },
                },
              },
              settingsButton(),
            ]
          : buttons,
        meta: { liveChat: started.ok ? 'started' : 'failed' },
      };
    }

    // 0b) Hands-free: Bestätigung ausführen oder Fähigkeiten anbieten
    const handsFreeDone = await tryExecuteHandsFreeCommand(text);
    if (handsFreeDone) {
      return {
        agent: 'system',
        ok: true,
        draftText: handsFreeDone.draftText,
        bullets: handsFreeDone.bullets,
        buttons,
        meta: { handsFree: 'executed' },
      };
    }
    if (wantsHandsFreeSetup(text)) {
      const report = await probeHandsFreeCapabilities();
      const offer = buildHandsFreeOffer(report);
      return {
        agent: 'system',
        ok: true,
        draftText: offer.draftText,
        bullets: offer.bullets,
        buttons: offer.buttons,
        meta: { handsFree: 'offer', report },
      };
    }

    // 1) Selbsterklärung / Hilfe-Katalog (vor Stimmen-Umschalten)
    if (wantsSelfExplain(text)) {
      const hits = searchHelpEntries(text, 2);
      const isOverview =
        /\b(was kannst du|wer bist du|erkl[aä]r(?:e|t)?\s*dich|anleitung)\b/i.test(
          text,
        ) && hits.length === 0;

      if (isOverview || (hits.length === 0 && /\bwas kannst du\b/i.test(text))) {
        return {
          agent: 'system',
          ok: true,
          draftText: overviewSpeech(),
          bullets: [
            'Mikrofon = Fragen',
            'Kalender = Timeline/Plan',
            'Stimme per Sprachbefehl',
          ],
          buttons: [
            ...voicePickButtons().slice(0, 3),
            settingsButton(),
          ],
          meta: { selfExplain: 'overview' },
        };
      }

      if (hits.length > 0) {
        const primary = hits[0]!;
        const speech =
          hits.length === 1
            ? helpEntrySpeech(primary)
            : `${helpEntrySpeech(primary)} Kurz noch: ${hits[1]!.title} — ${hits[1]!.what}`;
        const voiceRelated = primary.id === 'voice' || /stimme/i.test(text);
        return {
          agent: 'system',
          ok: true,
          draftText: speech,
          bullets: hits.map((h) => h.title),
          buttons: voiceRelated
            ? [...voicePickButtons().slice(0, 4), settingsButton()]
            : buttons,
          meta: { selfExplain: primary.id, helpIds: hits.map((h) => h.id) },
        };
      }

      return {
        agent: 'system',
        ok: true,
        draftText: overviewSpeech(),
        bullets: ['Hilfe', 'Frag konkret nach'],
        buttons,
        meta: { selfExplain: 'fallback' },
      };
    }

    // 2) Stimme umschalten mit Namen
    const voiceId = matchVoiceId(text);
    if (voiceId && wantsVoiceChange(text)) {
      try {
        await updateUserProfile({ voiceId, ttsProvider: 'cartesia' });
        const name =
          CARTESIA_VOICES.find((v) => v.id === voiceId)?.name ?? voiceId;
        return {
          agent: 'system',
          ok: true,
          draftText: `Alles klar — ich spreche ab jetzt mit der Stimme von ${name}.`,
          bullets: [`Stimme: ${name}`, 'Sofort aktiv'],
          buttons,
          meta: { voiceId },
        };
      } catch {
        return {
          agent: 'system',
          ok: false,
          draftText:
            'Die Stimme konnte ich gerade nicht umschalten — öffne bitte kurz die Einstellungen unter Einrichtung → Stimme.',
          bullets: ['Stimme', 'Einstellungen'],
          buttons,
          error: { code: 'voice_save', message: 'profile save failed' },
        };
      }
    }

    // 3) „Stimme ändern“ ohne Namen
    if (wantsVoiceChange(text) && !voiceId) {
      useFinnusStore.getState().requestOpenSettings('voice');
      return {
        agent: 'system',
        ok: true,
        draftText:
          'Klar — sag z. B. „Stimme von Lukas“, tippe eine Stimme hier, oder wähl in den Einstellungen unter Einrichtung → Stimme.',
        bullets: ['Sprachbefehl', 'Oder tippen', 'Einstellungen'],
        buttons: [...voicePickButtons(), settingsButton()],
        meta: { openedSettings: true, voicePick: true },
      };
    }

    // 4) Taschenlampe
    const flash = wantsFlashlight(text);
    if (flash) {
      const result =
        flash === 'toggle'
          ? await toggleFlashlight()
          : await setFlashlight(flash === 'on');
      if (result.ok) {
        return {
          agent: 'system',
          ok: true,
          draftText: result.on
            ? 'Taschenlampe ist an.'
            : 'Taschenlampe ist aus.',
          bullets: [result.on ? 'Licht an' : 'Licht aus'],
          buttons,
          meta: { flashlight: result.on },
        };
      }
      return {
        agent: 'system',
        ok: false,
        draftText:
          result.message ||
          'Taschenlampe konnte ich nicht schalten. Bitte Kamera-Berechtigung erlauben.',
        bullets: ['Taschenlampe'],
        buttons,
        error: { code: 'torch', message: result.message ?? 'fail' },
      };
    }

    // 5) Schrift / Buttons per Sprache
    const uiScalePatch = parseUiScaleVoice(text);
    if (uiScalePatch) {
      try {
        await updateUserProfile(uiScalePatch);
        const bits = [
          uiScalePatch.uiTextScale
            ? `Schrift ${uiScalePatch.uiTextScale === 'large' ? 'groß' : uiScalePatch.uiTextScale === 'normal' ? 'normal' : 'auto'}`
            : null,
          uiScalePatch.uiButtonScale
            ? `Buttons ${uiScalePatch.uiButtonScale === 'large' ? 'groß' : uiScalePatch.uiButtonScale === 'normal' ? 'normal' : 'auto'}`
            : null,
        ].filter(Boolean);
        return {
          agent: 'system',
          ok: true,
          draftText: `Passt — ${bits.join(' und ')}. Sofort aktiv.`,
          bullets: bits as string[],
          buttons,
          meta: { uiScale: uiScalePatch },
        };
      } catch {
        return {
          agent: 'system',
          ok: false,
          draftText:
            'Die Anzeige-Größe konnte ich nicht speichern — bitte unter Einrichtung → Über dich tippen.',
          bullets: ['Schrift & Buttons'],
          buttons,
          error: { code: 'ui_scale', message: 'profile save failed' },
        };
      }
    }

    // 6) Einstellungen öffnen
    if (wantsSettings(text)) {
      useFinnusStore.getState().requestOpenSettings();
      return {
        agent: 'system',
        ok: true,
        draftText: 'Ich öffne die Einstellungen für dich.',
        bullets: ['Einstellungen'],
        buttons,
        meta: { openedSettings: true },
      };
    }

    return {
      agent: 'system',
      ok: true,
      draftText:
        'Alles klar — Stimme, Schriftgröße, Taschenlampe, Einstellungen oder „Was kannst du?“ kannst du mir sagen. Sonst tippe auf Einstellungen.',
      bullets: ['App-Steuerung', 'Selbsterklärung'],
      buttons,
    };
  },
};
