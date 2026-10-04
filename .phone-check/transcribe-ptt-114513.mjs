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
const dir = path.join(__dirname, 'ptt-split-1145');
const parts = [];

for (let i = 0; i < 6; i++) {
  const file = path.join(dir, `chunk${i}.mp3`);
  if (!fs.existsSync(file)) continue;
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), `chunk${i}.mp3`);
  form.append('model', 'gpt-4o-transcribe');
  form.append('language', 'de');
  form.append('response_format', 'text');
  form.append(
    'prompt',
    'Deutscher App-Testbericht Yorro Timeline Bugs. Neu suchen doppelt, Hotel Paris, Anreise, Frühstück Distanz, Speisekarte Buttons überlappen, Plan Hamburg.',
  );
  process.stdout.write(`\n===== CHUNK ${i} =====\n`);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('ERR', i, res.status, text);
    process.exit(1);
  }
  console.log(text.trim());
  parts.push(`===== CHUNK ${i} =====\n${text.trim()}\n`);
}

fs.writeFileSync(path.join(__dirname, 'ptt-2026-09-03-114513-full.txt'), parts.join('\n'));
console.log('\nWrote full transcript');
