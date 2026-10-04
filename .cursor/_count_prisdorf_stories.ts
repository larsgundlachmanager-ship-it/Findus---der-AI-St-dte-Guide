import { readFileSync } from 'fs';

const pack = JSON.parse(readFileSync('data/staedte/prisdorf.json', 'utf8'));
const spots = pack.spots || [];
function tagsOf(s: any): string[] {
  const t = s.tags || [];
  return (Array.isArray(t) ? t : []).map((x: any) => String(x).toLowerCase());
}
const story = spots.filter((s: any) => {
  const t = tagsOf(s);
  return t.includes('story') || t.includes('story_enriched');
});
console.log('spots', spots.length, 'storyish', story.length);
console.log(
  'story gps',
  story.filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).length,
);
const roles: Record<string, number> = {};
for (const s of story) {
  const r = String(s.pack_role || 'none');
  roles[r] = (roles[r] || 0) + 1;
}
console.log('roles', roles);
// no story tag but might still map?
const noStory = spots.filter((s: any) => {
  const t = tagsOf(s);
  return !t.includes('story') && !t.includes('story_enriched') && !t.includes('directory');
});
console.log('neither story nor directory', noStory.length);
console.log(
  'sample neither',
  noStory.slice(0, 8).map((s: any) => ({ name: s.name, tags: s.tags, role: s.pack_role })),
);
