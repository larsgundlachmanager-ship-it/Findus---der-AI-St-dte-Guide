import type { Module2Agent } from './types';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import {
  bumpSmalltalkCompanion,
  getCompanionPersonaNotes,
  markSmalltalkCompanion,
  rememberCompanionPersonaNote,
} from '../../services/handsFree/smalltalkCompanionMode';
import { formatUserNamePromptRule } from '../../services/persona/userNameThrottle';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_SMALLTALK_COMPANION_BLOCK,
} from '../../services/concierge/findusResponsePolicy';

/**
 * Emotionaler Companion / Persönlichkeits-Chat — Fast-Lane, keine Research.
 */
export const smalltalkAgent: Module2Agent = {
  id: 'smalltalk',
  intents: ['smalltalk'],
  async run({ task, rucksack }) {
    markSmalltalkCompanion('smalltalk_agent');
    bumpSmalltalkCompanion('smalltalk_agent');

    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const city = place.speechPlace;
    const profile = getCachedUserProfile();
    const nameRule = formatUserNamePromptRule(profile?.firstName);
    const notes = getCompanionPersonaNotes();
    const userLine = (task.rewrittenText || '').trim();

    let draft =
      `Ich bin bei dir${place.city ? ` in ${place.city}` : ''}. ` +
      (userLine
        ? `Zu dem, was du gerade gesagt hast: ich hör dich. Erzähl weiter — ich bin da.`
        : `Erzähl ruhig, was dich beschäftigt — ich bin da.`);

    if (hasGeminiApiKey()) {
      try {
        const raw = await generateGeminiText(
          [
            FINDUS_SMALLTALK_COMPANION_BLOCK,
            nameRule,
            `Ort-Kontext (nur Atmosphäre, nicht recherchieren): ${city}`,
            notes.length
              ? `Bisherige Persönlichkeits-Notizen aus dem Gespräch:\n- ${notes.join('\n- ')}`
              : 'Noch keine Gesprächs-Notizen — baue behutsam Persönlichkeit auf (Interessen, Ton, Sorgen).',
            '',
            `User: ${userLine || '(kurz begrüßen, einladend)'}`,
            '',
            'Antworte warm, menschlich, in Echtzeit-Ton. Max 1200 Zeichen, lieber kürzer.',
            'Keine Recherche, keine Orte/Preise/Routes erfinden, keine Buttons erzwingen.',
            'Keine Doppel-Bridge. Kein Support-Skript („wie kann ich dir helfen?“).',
            FINDUS_FEW_SHOT_DISCLAIMER,
          ].join('\n'),
          {
            useFindusSystem: true,
            maxTokens: 700,
            temperature: 0.75,
            allowProEscalate: false,
          },
        );
        if (raw.trim().length > 10) draft = raw.trim();
      } catch {
        /* draft bleibt */
      }
    }

    // Leichte Persönlichkeits-Spur für die Session
    if (userLine.length >= 12) {
      rememberCompanionPersonaNote(userLine.slice(0, 100));
    }

    return {
      agent: 'smalltalk',
      ok: true,
      draftText: draft,
      bullets: notes.slice(0, 2).length ? notes.slice(0, 2) : ['Ich bin da'],
      buttons: [],
      meta: {
        smalltalkCompanion: true,
        silent: false,
      },
    };
  },
};
