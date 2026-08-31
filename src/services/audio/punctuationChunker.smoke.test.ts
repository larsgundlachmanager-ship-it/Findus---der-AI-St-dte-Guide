/**
 * Fast-Hook am ersten Satzzeichen; Folge = ganze Sätze (Prefetch füllt die Lücken).
 */
import {
  FIRST_HOOK_MAX_CHARS,
  extractStreamingChunks,
  splitTextToStreamingChunks,
} from './punctuationChunker';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const sample =
  'Klar, der beste Platz für Sonnenuntergang ist die Düne am Nordstrand, ' +
  'und danach kannst du noch kurz zum Leuchtturm laufen. ' +
  'Wenn du Hunger hast, liegt ein Imbiss nur zwei Minuten entfernt!';

const chunks = splitTextToStreamingChunks(sample);
assert(chunks.length >= 2, `expected ≥2 chunks, got ${chunks.length}`);
assert(
  chunks[0]!.length <= FIRST_HOOK_MAX_CHARS,
  `first hook too long: ${chunks[0]!.length} > ${FIRST_HOOK_MAX_CHARS}`,
);
assert(
  /[,.!?]$/.test(chunks[0]!.trim()) || chunks[0]!.length <= FIRST_HOOK_MAX_CHARS,
  `first hook should end on punctuation or hard-cap: «${chunks[0]}»`,
);
assert(
  chunks[0]!.toLowerCase().startsWith('klar'),
  `first hook should start ASAP: «${chunks[0]}»`,
);
assert(
  chunks[0] === 'Klar,',
  `fast hook until first punctuation, got «${chunks[0]}»`,
);

const liveToken = extractStreamingChunks('Klar,', { isFirstChunk: true });
assert(liveToken.chunks[0] === 'Klar,', `live token got «${liveToken.chunks[0]}»`);

const early = extractStreamingChunks('Klar, der Rest kommt später.', {
  isFirstChunk: true,
});
assert(early.chunks[0] === 'Klar,', `early hook got «${early.chunks[0]}»`);
assert(
  (early.chunks[1] ?? early.rest).startsWith('der Rest'),
  `follow got «${early.chunks[1] ?? early.rest}»`,
);

const morning =
  'Guten Morgen, Lars. Gestern war es ruhig. Heute scheint die Sonne.';
const morningChunks = splitTextToStreamingChunks(morning);
assert(
  morningChunks[0] === 'Guten Morgen,',
  `morning fast hook, got «${morningChunks[0]}»`,
);
assert(
  morningChunks[1]?.startsWith('Lars'),
  `morning sentence 2, got «${morningChunks[1]}»`,
);

const longNoPunct = 'ABCDEFGHIJ '.repeat(12).trim();
const capped = extractStreamingChunks(longNoPunct, { isFirstChunk: true });
assert(capped.chunks.length >= 1, 'hard-cap should emit a chunk');
assert(
  capped.chunks[0]!.length <= FIRST_HOOK_MAX_CHARS,
  `hard-cap chunk too long: ${capped.chunks[0]!.length}`,
);

const addr =
  'Ich führ dich jetzt zu Ulmenallee 23, 25421 Pinneberg, Deutschland — klingt gut.';
const addrChunks = splitTextToStreamingChunks(addr);
assert(
  !addrChunks.some((c) => /^deutschland\b/i.test(c.trim())),
  `Adresse nicht am Land-Komma zerlegen: ${JSON.stringify(addrChunks)}`,
);
assert(
  addrChunks[0]!.includes('Ulmenallee') || addrChunks[0]!.length <= FIRST_HOOK_MAX_CHARS,
  `Adress-Hook: «${addrChunks[0]}»`,
);

console.log(
  `[ok] punctuationChunker firstHook≤${FIRST_HOOK_MAX_CHARS} chunks=${chunks.length} «${chunks[0]}»`,
);
