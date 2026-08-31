/**
 * Wetter darf nicht an Flug kleben; Gebäude-Spickzettel = Name · Höhe.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pipeline/queryRewriter.smoke.test.ts
 *      npx --yes --package tsx@4.19.4 tsx src/services/concierge/speechMemoryBullets.smoke.test.ts
 */

import { rewriteQuery } from './queryRewriter';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const { rewritten, changed } = rewriteQuery('Wie alt ist Manuel Neuer?', {
    lastPlaceName: 'Ballsporthalle',
    lastTopic: 'Hamburg Towers',
    lastAssistantSnippet: 'Die Towers spielen am Freitag. Wann soll ich Tickets suchen?',
  });
  assert(!changed, `person-age trivia must not rewrite, got: ${rewritten}`);
  assert(!/Towers|Ballsporthalle|Thema:/i.test(rewritten), `no sticky leak: ${rewritten}`);
}

{
  const { rewritten, changed } = rewriteQuery('Wie alt ist der Papst?', {
    lastTopic: 'saure Gurkenzeit',
    lastAssistantSnippet: 'Die Gurkenzeit war im Mittelalter.',
  });
  assert(!changed, `papst trivia must not rewrite, got: ${rewritten}`);
}

{
  const { rewritten, changed } = rewriteQuery('Wie wird das Wetter morgen?', {
    lastPlaceName: 'Flughafen Wien',
    lastTopic: 'Flug nach Wien',
    lastAssistantSnippet: 'Wann startet dein Flug? Soll ich Leave-by rechnen?',
  });
  assert(!changed, `weather must not rewrite onto flight, got: ${rewritten}`);
  assert(!/Flug|Leave-by|Thema:|gerade gefragt/i.test(rewritten), `no flight sticky: ${rewritten}`);
}

{
  const { rewritten, changed } = rewriteQuery('mehr dazu', {
    lastTopic: 'Hamburg Towers',
  });
  assert(changed, 'echte Follow-ups dürfen Bezug behalten');
  assert(/Bezug:.*Towers/i.test(rewritten), `follow-up keeps topic: ${rewritten}`);
}

console.log('queryRewriter.smoke.test.ts OK');
