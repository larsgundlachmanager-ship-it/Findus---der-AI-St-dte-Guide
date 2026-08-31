/**
 * ResearchPack: Kriterien-Score + Prompt-Format.
 */
import assert from 'node:assert/strict';
import {
  buildDiningResearchPack,
  formatResearchPackForPrompt,
  scoreCandidateCriteria,
} from './researchPack';
import type { PitchCandidate, PitchWish } from '../../pitch/types';

const wishes: PitchWish[] = [
  { text: 'Pannfisch', hardness: 'must', kind: 'dish' },
  { text: 'Elbblick', hardness: 'nice', kind: 'vibe' },
];

const a: PitchCandidate = {
  name: 'Fischers Fritz',
  lat: 53.54,
  lng: 9.98,
  mapsUrl: 'https://maps.example/a',
  source: 'places',
  softTags: ['pannfisch', 'elbblick', 'terrasse', 'sunset'],
  hardEvidence: ['pannfisch'],
  rating: 4.6,
  ratingCount: 200,
  openNow: true,
  distFromAnchorM: 800,
};

const b: PitchCandidate = {
  name: 'Teures Rooftop',
  lat: 53.55,
  lng: 9.99,
  mapsUrl: 'https://maps.example/b',
  source: 'places',
  softTags: ['steak', 'view'],
  hardEvidence: [],
  rating: 4.8,
  ratingCount: 50,
  openNow: true,
  priceTotalEur: 120,
  distFromAnchorM: 2000,
};

const scored = scoreCandidateCriteria(
  a,
  wishes,
  'Pannfisch Sonnenuntergang Elbblick',
  Date.now(),
);
assert.ok(scored.metCount >= 3, `expected met>=3 got ${scored.metCount}`);

const pack = buildDiningResearchPack({
  authorIntent: 'Abendessen Pannfisch + Sunset',
  spokenBridge: 'Alles klar, ich schau was passt.',
  userText: 'Pannfisch zum Sonnenuntergang mit Elbblick',
  wishes,
  visitAtMs: Date.now() + 3_600_000,
  shortlist: [a, b],
  ambient: { sunset_hm: '20:33', temp_c: 8, sky: 'klar' },
});
assert.equal(pack.shortlist.length, 2);
assert.ok(pack.speakPicks.length <= 2);
const prompt = formatResearchPackForPrompt(pack);
assert.ok(/RESEARCH_PACK/.test(prompt));
assert.ok(/20:33/.test(prompt));
assert.ok(/Fischers Fritz/.test(prompt));

console.log('researchPack.smoke: ok');
