/**
 * Run: npx --yes tsx src/services/concierge/outfitWeatherPresent.smoke.test.ts
 */
import {
  finalizeOutfitWeatherBullets,
  looksLikeRainAsk,
  stripOutfitWeatherTourActions,
} from './outfitWeatherPresent';
import { sanitizeCardTitle, deriveSpickzettelTitle } from './spickzettelTitle';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const speech =
    'Heute wird es warm, 22 Grad, leichte Kleidung reicht, nimm eine dünne Jacke mit für den Abend.';
  const bullets = finalizeOutfitWeatherBullets([], speech, {
    userText: 'Was soll ich anziehen?',
  });
  assert(bullets.length >= 1, 'outfit bullets not empty');
  assert(
    bullets.every((b) => !/also,?\s+in\s+/i.test(b)),
    'no prose city lead in bullets',
  );
  assert(
    bullets.every((b) => b.split(/\s+/).length <= 8),
    `fact chips short: ${bullets.join(' | ')}`,
  );
  assert(
    bullets.some((b) => /jacke|22|°|grad/i.test(b)),
    `jacket/temp chip: ${bullets.join(' | ')}`,
  );
}

{
  const proseSpeech =
    'Also, in Prisdorf sieht es so aus, gerade liegst du bei 22 Grad, wechselhaft, bis 24 Grad, heute kein Regen.';
  const bullets = finalizeOutfitWeatherBullets(
    ['Also, in Prisdorf sieht es so aus, gerade liegst du bei 22 Grad'],
    proseSpeech,
    { userText: 'Wie ist das Wetter?' },
  );
  assert(
    !bullets.some((b) => /also|liegst du|sieht es so aus/i.test(b)),
    `no prose dump: ${bullets.join(' | ')}`,
  );
  assert(
    bullets.some((b) => /22|24|°|wechselhaft|kein regen|trocken/i.test(b)),
    `has fact chip: ${bullets.join(' | ')}`,
  );
}

{
  assert(looksLikeRainAsk('Wird es heute noch regnen?') === true, 'rain ask');
  const rainBullets = finalizeOutfitWeatherBullets(
    [],
    'Heute bleibt es trocken, kein Regen mehr — so um die 18 Grad.',
    { userText: 'Wird es heute noch regnen?' },
  );
  assert(rainBullets.length >= 1 && rainBullets.length <= 2, 'rain max 2 chips');
  assert(
    /regen|trocken/i.test(rainBullets[0] ?? ''),
    `rain first: ${rainBullets.join(' | ')}`,
  );
  assert(
    deriveSpickzettelTitle({
      userText: 'Wird es heute noch regnen?',
      speech: 'Heute kein Regen mehr.',
      bullets: rainBullets,
    }) === 'Regen',
    'rain title',
  );
}

{
  const stripped = stripOutfitWeatherTourActions([
    {
      type: 'START_NAVIGATION',
      label: 'Route',
      payload: { destName: 'Café' },
    },
    {
      type: 'OPEN_URL',
      label: 'Radar',
      payload: { url: 'https://example.com' },
    },
  ] as any);
  assert(
    !stripped.some((a) => a.type === 'START_NAVIGATION'),
    'weather strips nav',
  );
  assert(stripped.some((a) => a.type === 'OPEN_URL'), 'keeps url');
}

{
  assert(sanitizeCardTitle('[]') === null, '[] title sanitized');
  assert(sanitizeCardTitle('Wecker') === 'Wecker', 'Wecker title kept');
}

console.log('outfitWeatherPresent.smoke.test.ts ok');
