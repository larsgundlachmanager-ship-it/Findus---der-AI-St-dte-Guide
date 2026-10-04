const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const m = env.match(/^EXPO_PUBLIC_OPENAI_API_KEY=(.+)$/m);
if (!m) throw new Error('no openai key');
const key = m[1].trim();
const filePath =
  'c:/Users/larsf/OneDrive/Desktop/WhatsApp Ptt 2026-09-02 at 23.33.47.ogg';
const buf = fs.readFileSync(filePath);
const boundary = '----cursor' + Date.now();
const chunks = [];
function push(s) {
  chunks.push(Buffer.from(s));
}
push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`);
push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n`);
push(
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ptt.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`,
);
chunks.push(buf);
push(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat(chunks);
fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
  },
  body,
})
  .then(async (r) => {
    const t = await r.text();
    console.log('STATUS', r.status);
    console.log(t);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
