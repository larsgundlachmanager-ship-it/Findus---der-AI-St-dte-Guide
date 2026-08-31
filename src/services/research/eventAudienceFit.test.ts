import test from 'node:test';
import assert from 'node:assert/strict';
import { spotFitsUserAudience } from './eventAudienceFit';

test('audience fit: kids / techno / ue30', () => {
  const kids = {
    name: 'Kalla Spielstadt',
    kindHint: 'kids',
    hook: 'In der Kalla Spielstadt ist heute Kinderprogramm.',
    audienceTags: ['kids', 'family'],
    audienceMaxAge: 12,
  };
  const techno = {
    name: 'Warehouse Rave',
    kindHint: 'party',
    hook: 'Im Warehouse Rave laeuft Underground Techno ab 23 Uhr.',
    audienceTags: ['nightlife', 'techno'],
    audienceMinAge: 18,
  };
  const ue30 = {
    name: 'Ue30 Night',
    kindHint: 'party',
    hook: 'Die Ue30 Night im Club startet um 21 Uhr.',
    audienceTags: ['ue30', 'nightlife'],
    audienceMinAge: 30,
  };

  assert.equal(
    spotFitsUserAudience(kids, { age: 28, travelParty: 'solo' }),
    false,
  );
  assert.equal(
    spotFitsUserAudience(kids, { age: 34, travelParty: 'family' }),
    true,
  );
  assert.equal(
    spotFitsUserAudience(techno, { age: 72, nightlifeOk: false }),
    false,
  );
  assert.equal(
    spotFitsUserAudience(techno, { age: 24, nightlifeOk: true }),
    true,
  );
  assert.equal(spotFitsUserAudience(ue30, { age: 24 }), false);
  assert.equal(spotFitsUserAudience(ue30, { age: 35 }), true);
  assert.equal(
    spotFitsUserAudience(kids, { age: 30, softSkipTags: ['kids'] }),
    false,
  );
});
