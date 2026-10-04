import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const ui = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-now.xml'),
  'utf8',
);
for (const m of ui.matchAll(
  /checkable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g,
)) {
  const cx = Math.round((+m[1] + +m[3]) / 2);
  const cy = Math.round((+m[2] + +m[4]) / 2);
  console.log(cx, cy, m[0].slice(0, 120));
}
