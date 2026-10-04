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
const file = path.join(__dirname, 'testday-ptt-2209.ogg');
const buf = fs.readFileSync(file);

const form = new FormData();
form.append('file', new Blob([buf], { type: 'audio/ogg' }), 'ptt.ogg');
form.append('model', 'whisper-1');
form.append('language', 'de');
form.append('response_format', 'text');

const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}` },
  body: form,
});
const text = await res.text();
if (!res.ok) {
  console.error('ERR', res.status, text);
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, 'testday-ptt-2209.txt'), text);
console.log(text);
