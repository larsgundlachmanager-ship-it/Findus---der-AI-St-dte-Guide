const fs=require("fs");const path=require("path");
const p="src/services/concierge/visualBullets.ts";
let s=fs.readFileSync(p,"utf8").replace(/\r\n/g,"\n");
const re=/export function looksLikeProseBullet\(raw: string\): boolean \{[\s\S]*?\n\}/;
const next=`export function looksLikeProseBullet(raw: string): boolean {
  const b = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!b) return true;
  const words = b.split(/\\s+/).length;
  // Zahl-Fakten (Einwohner/km²/Alter/Preis) bleiben Chips, auch etwas länger
  if (/\\d/.test(b) && words <= 14) return false;
  if (/[.!?]$/.test(b) && words >= 8) return true;
  if (PROSE_BULLET_OPENER_RE.test(b) && words >= 6 && !/\\d/.test(b)) return true;
  if (words >= 12 && !b.includes('·') && !/[€$°%]/.test(b) && !/\\d/.test(b)) return true;
  return false;
}`;
if(!re.test(s)) throw new Error('fn not found');
s=s.replace(re, next);
const abs=path.resolve(p); const tmp=abs+'.tmpwrite';
fs.writeFileSync(tmp,s); fs.renameSync(tmp,abs);
console.log('prose softened');
