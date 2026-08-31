/**
 * Spickzettel: genannte Gebäude mit Name + Höhe.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/speechMemoryBullets.smoke.test.ts
 */

import {
  deriveMemoryBullets,
  extractNamedHeights,
} from './speechMemoryBullets';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const speech =
    'Das höchste Gebäude ist der Heinrich-Hertz-Turm mit 279 m. Der Tele-Michel ist 277 m hoch, und der St. Nikolai-Turm kommt auf 147 m.';
  const named = extractNamedHeights(speech);
  assert(named.length >= 2, `named heights expected ≥2, got ${named.join(' | ')}`);
  assert(
    named.some((b) => /Tele-Michel/i.test(b) && /277/i.test(b)),
    `Tele-Michel · 277 m missing: ${named.join(' | ')}`,
  );
  assert(
    named.some((b) => /Heinrich-Hertz/i.test(b) && /279/i.test(b)),
    `Hertz · 279 m missing: ${named.join(' | ')}`,
  );

  const bullets = deriveMemoryBullets(speech, [], {
    userText: 'Was sind die höchsten Gebäude in Hamburg?',
  });
  assert(bullets.length >= 2, `bullets ≥2, got ${bullets.join(' | ')}`);
  assert(
    bullets.every((b) => /·\s*\d/.test(b) || /Jahre|geboren/i.test(b)),
    `each building bullet needs name+height, got: ${bullets.join(' | ')}`,
  );
  assert(
    !bullets.some((b) => /^(?:Höhe\s+)?\d+\s*m$/i.test(b)),
    `no bare meter-only bullet: ${bullets.join(' | ')}`,
  );
  assert(
    bullets.some((b) => /Tele-Michel/i.test(b)),
    `Tele-Michel in bullets: ${bullets.join(' | ')}`,
  );
}

{
  const papst = deriveMemoryBullets(
    'Papst Leo XIV. heißt mit bürgerlichem Namen Robert Prevost und wurde am 14. September 1955 geboren, er ist 70 Jahre alt.',
    [],
    { userText: 'Wie alt ist der Papst?' },
  );
  assert(papst.some((b) => /70\s*Jahre/i.test(b)), `papst age: ${papst.join(' | ')}`);
}

console.log('speechMemoryBullets.smoke.test.ts OK');
