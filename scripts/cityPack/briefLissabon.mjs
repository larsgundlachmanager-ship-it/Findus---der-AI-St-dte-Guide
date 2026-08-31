#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadPack, ROOT } from './lib.mjs';

const pack = loadPack('lissabon');
const stories = (pack.spots || [])
  .filter((s) => s.pack_role !== 'directory')
  .sort((a, b) => (a.place_tier ?? 9) - (b.place_tier ?? 9));
const thin = stories.filter((s) => {
  const t = (pack.trigger_points || []).find((x) => x.id === s.id);
  return (t?.deep_data_pool || []).length < 6 || (t?.general_info || '').length < 100;
});
const lines = [
  `# Agent Deep Research — ${pack.name}`,
  '',
  'Pipeline fertig (Geocode-Bootstrap + Deep Research). Places-Legacy API war nicht verfügbar.',
  '',
  '## Stats',
  `- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}`,
  `- Offline-QA: ${(pack._offline_qa || []).length}`,
  `- Version: ${pack.data_version}`,
  `- Thin: ${thin.length}`,
  '',
  '## Stories',
  ...stories.map(
    (s, i) => `${i + 1}. ${s.name} (T${s.place_tier}) \`${s.id}\``,
  ),
  '',
];
const out = path.join(ROOT, 'data', 'staedte', 'lissabon.agent-brief.md');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('brief →', out);

for (const s of stories.filter((x) => x.place_tier === 1)) {
  const t = pack.trigger_points.find((x) => x.id === s.id);
  const chars = (t?.deep_data_pool || []).reduce(
    (n, e) => n + String(e.text || e || '').length,
    0,
  );
  console.log(
    `T1 ${s.name} deep=${(t?.deep_data_pool || []).length} chars=${chars}`,
  );
}
