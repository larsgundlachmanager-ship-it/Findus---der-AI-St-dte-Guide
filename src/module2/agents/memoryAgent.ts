import type { Module2Agent } from './types';
import { getCachedUserProfile } from '../../services/userProfileService';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';

function formatRecallBullets(
  facts: string[],
  entities: { name: string; type: string }[],
  threads: string[],
): string[] {
  const out: string[] = [];
  for (const f of facts.slice(-4)) {
    out.push(f.length > 72 ? `${f.slice(0, 69)}…` : f);
  }
  for (const e of entities.slice(0, 2)) {
    out.push(`${e.type}: ${e.name}`);
  }
  for (const t of threads.slice(-2)) {
    out.push(t.length > 72 ? `${t.slice(0, 69)}…` : t);
  }
  return out.slice(0, 4);
}

export const memoryAgent: Module2Agent = {
  id: 'memory',
  intents: ['memory'],
  async run({ task, rucksack }) {
    const profile = getCachedUserProfile();
    const mem = useUserMemoryStore.getState();
    const cityId = profile?.cityId ?? rucksack.cityHint ?? null;

    const entities = mem.findEntities({
      cityId,
      nameQuery: task.rewrittenText?.slice(0, 40),
    });
    const confirmed = entities.filter((e) => e.isConfirmed);
    const learned = (profile?.learnedFacts ?? []).filter((f) => {
      const q = task.rewrittenText.toLowerCase();
      if (q.length < 4) return true;
      return f.toLowerCase().includes(q.slice(0, 24));
    });
    const threads = (() => {
      try {
        const {
          listResumableThreads,
        } = require('../../services/memory/conversationThreads') as {
          listResumableThreads: () => Array<{
            label: string;
            summary: string;
            openLoops: string[];
          }>;
        };
        return listResumableThreads()
          .slice(0, 4)
          .map((t) =>
            t.openLoops[0] ? `${t.label}: ${t.openLoops[0]}` : t.label,
          );
      } catch {
        return profile?.openThreads ?? [];
      }
    })();
    const itinerary = mem.travelItinerary?.summary?.trim();

    const bullets = formatRecallBullets(
      learned,
      confirmed.map((e) => ({ name: e.name, type: e.type })),
      threads,
    );

    let draftText =
      learned.length > 0 || confirmed.length > 0 || threads.length > 0
        ? `Ich hab in deinem Gedächtnis nachgeschaut — ${learned.length ? 'ein paar Merker' : 'Orte und Themen'} für „${task.rewrittenText}“.`
        : `Zu „${task.rewrittenText}“ hab ich noch nichts Gespeichertes — sag mir gern, was ich mir merken soll.`;

    if (threads.length > 0 && /thema|gespräch|offen|worüber|thread/iu.test(task.rewrittenText)) {
      draftText = `Offene Themen bei mir: ${threads.slice(0, 3).join('; ')}.`;
    }

    if (itinerary && /plan|reise|itinerary|programm/iu.test(task.rewrittenText)) {
      draftText = `Dein Reiseplan steckt im Hinterkopf — ${itinerary.slice(0, 120)}${itinerary.length > 120 ? '…' : ''}`;
    }

    const store = useFinnusStore.getState();
    if (store.currentLocationName && confirmed.length === 0 && learned.length === 0) {
      draftText += ` Aktuell bist du ${store.currentLocationName ? `bei ${store.currentLocationName}` : 'unterwegs'}.`;
    }

    return {
      agent: 'memory',
      ok: true,
      draftText,
      bullets: bullets.length ? bullets : ['Gedächtnis', 'Merken on demand'],
      buttons: [
        {
          id: 'show_memory',
          label: '🧠 Zeig Merker',
          payload: { kind: 'ui', action: 'show_memory' },
        },
      ],
    };
  },
};
