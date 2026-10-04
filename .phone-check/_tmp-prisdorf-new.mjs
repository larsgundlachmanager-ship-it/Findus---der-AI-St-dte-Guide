import fs from 'node:fs';
const gaps = fs.readFileSync('data/staedte/prisdorf.gaps.md', 'utf8');
const ids = [...gaps.matchAll(/`(prisdorf[^`]+)`/g)].map((m) => m[1]);
const p = JSON.parse(fs.readFileSync('data/staedte/prisdorf.json', 'utf8'));
const stories = p.spots.filter((s) => s.pack_role === 'story');
const newStories = stories.filter((s) => !ids.includes(s.id));
console.log('gaps baseline spots:', ids.length);
console.log('current story:', stories.length);
console.log('NEW story not in gaps.md:', newStories.length);
for (const s of newStories) {
  console.log(`- ${s.name} | ${s.category} | ${s.id}`);
}
