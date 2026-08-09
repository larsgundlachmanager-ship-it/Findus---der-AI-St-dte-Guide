import type { Module2Agent } from './types';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';

/**
 * Echter Chat-Agent — kein Menü-Fallback.
 * Nur wenn der Router bewusst Smalltalk wählt.
 */
export const smalltalkAgent: Module2Agent = {
  id: 'smalltalk',
  intents: ['smalltalk'],
  async run({ task, rucksack }) {
    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const city = place.speechPlace;
    let draft =
      `Klar — ich bin bei dir ${place.city ? `in ${place.city}` : 'hier'}. ${task.rewrittenText ? `Zu „${task.rewrittenText}“: ` : ''}` +
      `Erzähl mir gerne, worauf du Lust hast, oder wir gehen einfach den nächsten Schritt.`;

    if (hasGeminiApiKey()) {
      try {
        const raw = await generateGeminiText(
          `Ort: ${city}\nUser: ${task.rewrittenText}\nAntwort kurz, warm, als Findus (max 2 Sätze). Kein Menü Essen/Weg/Geschichte. City-Pack egal.`,
          {
            useFindusSystem: true,
            maxTokens: 120,
            temperature: 0.7,
            allowProEscalate: false,
          },
        );
        if (raw.trim().length > 10) draft = raw.trim();
      } catch {
        /* draft bleibt */
      }
    }

    return {
      agent: 'smalltalk',
      ok: true,
      draftText: draft,
      bullets: [city, 'Chat'],
      buttons: [
        {
          id: 'suggest_food',
          label: `🍽️ Essen ${city.slice(0, 8)}`,
          payload: {
            kind: 'ui',
            action: 'suggest_food_city',
            data: { city },
          },
        },
      ],
    };
  },
};
