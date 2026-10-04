import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const x = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-dev.xml'),
  'utf8',
);
for (const m of x.matchAll(
  /text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g,
)) {
  const t = m[1];
  if (/808|localhost|Yorro|Development|Fetch|Home|Reload/i.test(t)) {
    console.log(
      Math.round((+m[2] + +m[4]) / 2),
      Math.round((+m[3] + +m[5]) / 2),
      t,
    );
  }
}
