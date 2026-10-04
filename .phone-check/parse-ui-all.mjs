import fs from 'fs';
const x = fs.readFileSync(new URL('./ui-now.xml', import.meta.url), 'utf8');
const re = /text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
let m;
while ((m = re.exec(x))) {
  const cx = Math.round((+m[2] + +m[4]) / 2);
  const cy = Math.round((+m[3] + +m[5]) / 2);
  if (m[1].trim()) console.log(cx, cy, m[1].slice(0, 60));
}
