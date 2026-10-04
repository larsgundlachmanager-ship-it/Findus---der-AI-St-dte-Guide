const fs = require('fs');
const p =
  'C:/Users/larsf/.cursor/projects/c-Users-larsf-Findus-2-0/agent-transcripts/b52eb171-0df0-4f48-b579-c24c6d54516e/b52eb171-0df0-4f48-b579-c24c6d54516e.jsonl';
const lines = fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean);
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i].includes('p4-01') && !lines[i].includes('p6-01-playbook')) continue;
  const j = JSON.parse(lines[i]);
  const blob = JSON.stringify(j);
  const idx = blob.indexOf('p4-01');
  console.log(blob.slice(idx, idx + 12000));
  break;
}
