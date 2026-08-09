import type { Module2Agent } from './types';

export const translationAgent: Module2Agent = {
  id: 'translation',
  intents: ['translation'],
  async run({ task }) {
    return {
      agent: 'translation',
      ok: true,
      draftText: `Ich übersetze die relevanten Teile — nicht die ganze Wand aus Text. Fokus auf Gerichte und Allergene zu „${task.rewrittenText}“.`,
      bullets: ['Kurz übersetzt', 'Allergene markiert'],
      buttons: [
        {
          id: 'translate',
          label: '🌐 Übersetzen',
          payload: { kind: 'ui', action: 'translate_menu' },
        },
      ],
    };
  },
};
