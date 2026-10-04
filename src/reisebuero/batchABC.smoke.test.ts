/**
 * Parser: keine Fake-1-Nacht aus „länger bleiben“; keine Fake-Kalendertage.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from './parseBriefSlots';
import { buildTheaterScene } from './research/theaterScene';
import { RESEARCH_STATUS_RAIL } from './research/progressPace';
import type { ResearchSpark } from './types';

const now = Date.parse('2026-09-17T12:00:00');

{
  const p = parseBriefSlots('ein tag laenger bleiben waere theoretisch optimal', now);
  assert.equal(p.stayNights, undefined);
  assert.equal(p.stayDays, undefined);
  assert.equal(p.dateStart, undefined);
}

{
  const p = parseBriefSlots('bis dienstag bleiben', now);
  assert.ok(p.dateEnd?.value, 'bis Dienstag → Abreise-Tag');
  assert.equal(p.dateStart, undefined, 'ohne Anreise kein Fake-Start');
}

{
  const p = parseBriefSlots('nächste Woche', now);
  assert.ok(p.dateWindow?.value || p.dateFlex?.value);
  assert.equal(p.dateStart, undefined, 'nächste Woche invents no day');
}

{
  const openIdx = RESEARCH_STATUS_RAIL.findIndex((r) => r.stage === 'open_space');
  const flightIdx = RESEARCH_STATUS_RAIL.findIndex((r) => r.stage === 'flight_matrix');
  assert.ok(openIdx >= 0 && flightIdx > openIdx, 'open_space before flight_matrix on rail');
  assert.equal(RESEARCH_STATUS_RAIL[0]?.stage, 'brief_plan', 'rail starts brief_plan');
  assert.equal(
    RESEARCH_STATUS_RAIL[RESEARCH_STATUS_RAIL.length - 1]?.stage,
    'package_pick',
    'rail ends package_pick',
  );
}

{
  const sparks: ResearchSpark[] = [
    {
      id: '1',
      kind: 'vibe',
      emoji: '☀️',
      label: 'Palma 22–26°',
      sub: 'klar',
      atMs: 1,
      lat: 39.57,
      lng: 2.65,
    },
    {
      id: '2',
      kind: 'vibe',
      emoji: '🌤️',
      label: 'Budapest 14–18°',
      sub: 'leicht bewölkt',
      atMs: 2,
      lat: 47.5,
      lng: 19.04,
    },
  ];
  const scene = buildTheaterScene(sparks, { stage: 'climate', weatherHint: 'warm' });
  assert.ok(
    scene.motifs.some((m) => /\d{1,2}/.test(m.label || '')),
    `climate motifs show temps ${scene.motifs.map((m) => m.label).join('|')}`,
  );
}

console.log('batchABC.smoke.test.ts ok');
