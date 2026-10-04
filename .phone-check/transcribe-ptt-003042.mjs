import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const m = env.match(/^EXPO_PUBLIC_OPENAI_API_KEY=(.+)$/m);
if (!m) {
  console.error('no OPENAI key');
  process.exit(1);
}
const key = m[1].trim().replace(/^["']|["']$/g, '');
const file =
  'c:/Users/larsf/OneDrive/Desktop/WhatsApp Ptt 2026-09-16 at 00.30.42.ogg';
const buf = fs.readFileSync(file);
console.log('bytes', buf.length);

const form = new FormData();
form.append('file', new Blob([buf], { type: 'audio/ogg' }), 'ptt.ogg');
form.append('model', 'whisper-1');
form.append('language', 'de');
form.append('response_format', 'verbose_json');
form.append(
  'prompt',
  'Deutscher Founder-Feedback zu Yorro App: Call 1 Bridge, Flug Leave-by, Taxi Deep-Link, Tasks nacheinander, Speech Stil.',
);

const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}` },
  body: form,
});
const text = await res.text();
if (!res.ok) {
  console.error('ERR', res.status, text.slice(0, 800));
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, 'ptt-2026-09-16-003042.json'), text);
const j = JSON.parse(text);
fs.writeFileSync(path.join(__dirname, 'ptt-2026-09-16-003042.txt'), j.text || '');
console.log(j.text || '');
if (Array.isArray(j.segments)) {
  console.log('\n---SEGMENTS---');
  for (const s of j.segments) {
    console.log(`[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`);
  }
}
