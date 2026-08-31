/**
 * Run: npx --yes tsx src/services/navigation/placeCityDisambiguate.smoke.test.ts
 */
import {
  analyzePlaceCityHits,
  buildPlaceCityChoiceSpeech,
} from './placeCityDisambiguate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const hits = [
  { lat: 53.551, lng: 9.993, label: 'Alsterhaus, Hamburg' },
  { lat: 53.868, lng: 10.687, label: 'Alsterhaus, Lübeck' },
];

const ask = analyzePlaceCityHits('navigiere mich zu Alsterhaus', hits);
assert(ask.kind === 'choice', `choice, got ${ask.kind}`);
if (ask.kind === 'choice') {
  assert(ask.options.length >= 2, 'Hamburg und Lübeck');
  assert(
    ask.options.some((o) => /hamburg/i.test(o.city)) &&
      ask.options.some((o) => /lübeck|luebeck/i.test(o.city)),
    'beide Städte',
  );
  const speech = buildPlaceCityChoiceSpeech(ask.place, ask.options);
  assert(/alsterhaus/i.test(speech), 'Ort im Satz');
  assert(/hamburg/i.test(speech) && /lübeck/i.test(speech), 'Städte nennen');
}

const named = analyzePlaceCityHits('Alsterhaus in Hamburg', hits);
assert(named.kind === 'one', 'genannte Stadt nimmt Hamburg');
if (named.kind === 'one') {
  assert(/hamburg/i.test(named.pick.city), `Hamburg, got ${named.pick.city}`);
}

console.log('placeCityDisambiguate.smoke.test.ts OK');
