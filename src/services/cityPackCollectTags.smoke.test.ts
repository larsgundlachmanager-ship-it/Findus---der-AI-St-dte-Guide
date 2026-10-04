/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityPackCollectTags.smoke.test.ts
 */
import {
  collectTags,
  shouldSkipApproachAndSubs,
} from './cityPackTags';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const tank = {
    id: 'prisdorf_team_tankstelle',
    name: 'team Tankstelle Peiner Hag 1a',
    category: 'tankstelle',
    pack_role: 'story',
    place_tier: 1,
    tags: ['story', 'story_enriched', 'must_have', 'landmark'],
  };
  const tags = collectTags(tank);
  assert(tags.includes('directory'), 'Tankstelle → directory');
  assert(tags.includes('amenity_skip'), 'Tankstelle → amenity_skip');
  assert(!tags.includes('story'), 'Tankstelle nie story');
  assert(!tags.includes('story_enriched'), 'Tankstelle nie story_enriched');
  assert(shouldSkipApproachAndSubs(tags, tank), 'Tankstelle skip Approaches');
}

{
  const bade = {
    name: 'Historisches Badehaus',
    category: 'geschichte',
    pack_role: 'story',
    tags: ['story', 'must_have'],
  };
  const tags = collectTags(bade);
  assert(tags.includes('story'), 'Badehaus bleibt story');
  assert(!tags.includes('directory'), 'Badehaus kein directory');
  assert(!shouldSkipApproachAndSubs(tags, bade), 'Story behält Approaches');
}

console.log('cityPackCollectTags.smoke.test.ts OK');
